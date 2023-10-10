'use strict';
const SunCalc = require('suncalc2');
const Schedule = require('node-schedule');
const Net = require('net');
const { IncomingMessage } = require('http');

// service request definitions
const REQ_SYSTEMINFO = 'APS1100160001';
const REQ_REAL_TIME_DATA = 'APS1100280002';
const REQ_POWER_OF_DAY = 'APS1100390003';
const REQ_INVERTER_SIGNAL_LEVEL = 'APS1100280030';
const REQ_ENERGY_OF_WMY = 'APS1100390004';
const REQ_WEEK = '00';
const REQ_MONTH = '01';
const REQ_YEAR = '02';
const REQ_END = 'END';
const INV_TYPE_STR_QS1 = 'qs1';
const INV_TYPE_STR_YC600 = 'yc600';
const INV_TYPE_STR_YC1000 = 'yc1000';
const INV_TYPE_STR_DS3 = 'ds3';

// Inverter type prefix from inverter ID
const INV_ID_TYPE_YC600 = 0x40;
const INV_ID_TYPE_YC100 = 0x50;
const INV_ID_TYPE_DS3 = 0x70;
const INV_ID_TYPE_QS1 = 0x80;
const INV_ID_TYPE_ONLY_REGISTERED = 0;

const ECU_RESPONSE_TIMOUT_MS = 3000;


/**
 * Usage:
 * - const myEcu = require('./lib/ecu');  
 * - ecu = new myEcu.Ecu(this); 
 * - ecu.init();
 * - ecu.unload();
 */
class Ecu {
  CMD_ENERGY_OF_WEEK_ID = 'ecu.cmd_energy_of_week';
  CMD_ENERGY_OF_MONTH_ID = 'ecu.cmd_energy_of_month';
  CMD_ENERGY_OF_YEAR_ID = 'ecu.cmd_energy_of_year';
  CMD_POWER_OF_DAY_ID = 'ecu.cmd_power_of_day';
  POWER_OF_DAY_DATE_ID = 'ecu.power_of_day_date';
  CMD_START_STOP = 'ecu.cmd_start_stop';
  TOTAL_ENERGY_YESTERDAY = 'ecu.total_energy_yesterday';
  DC_PEAK_POWER_TODAY = 'ecu.dc_peak_power_today';
  DC_PEAK_POWER_YESTERDAY = 'ecu.dc_peak_power_yesterday';
  CURRENT_DAY_ENERGY = 'ecu.current_day_energy';
  STATE_SUNSET_ID = 'info.sunset';
  STATE_SUNRISE_ID = 'info.sunrise';
  CONNECTION_ID = 'info.connection';
  SERVICE_COUNT_ID = 'info.service_count';

  /** 
   * Initialize Ecu - part 1
   * @param {adapter object} adapter
   */
  constructor(adapter) {
    this.adapter = adapter;
    this.ecuId = null;  // ID of ECU if known else null

    // timer and interval
    this.ecuPollIntervalTimeoutId = null;
    this.rspWatchDogTimeoutId = null;

    this.client = null;
    this.inverterPrefixTable = {}; // inverter id : object prefix table

    this.reqStartTime = null;
    this.serviceCount = 0;
    this.dc_peak_power_today = 0;

    // config 
    this.hideEcuId = true;
    this.ecuIp = '';
    this.ecuPort = 8899;
    this.longitude = 50.11552;
    this.latitude = 8.68417;
    this.extendedService = false;

    // states of state machines
    this.ecuState = 'stWaitForInit';
    this.serviceState = 'stSystemInfo';

    // command triggers
    if (this.extendedService) {
      this.cmdEnergyOfWeek = true;
      this.cmdEnergyOfMonth = true;
      this.cmdEnergyOfYear = true;
    }

    this.cmdPowerOfDay = true;
    this.powerOfDayDate = (new Date()).toISOString().substring(0, 10);
    this.cmdStartStop = true;

    // schedules
    this.jobStartAtSunrise = null;
    this.jobEndAtSunset = null;
    this.jobAtMidnight = null;
  }

  /**
   * Initialize Ecu - part 2
   * - Finalize initialization and call ecuStateMachine()
   */
  async init() {
    this.hideEcuId = this.adapter.config.hide_ecu_id ? true : false;
    //this.pollAlways = this.adapter.config.poll_always ? true : false;
    this.ecuIp = this.adapter.config.ecu_ip;
    this.ecuPort = this.adapter.config.ecu_port;
    this.ecuPollInterval = this.adapter.config.ecu_poll_interval;
    this.extendedService = (this.adapter.config.extended_service == true) ? true : false;
    this.ecuId = null;

    await this.adapter.log.debug(`init() this version is only for temporary testing and has to be replaced by an official release`)

    await this.createStaticObjects();
    this.adapter.getForeignObject('system.config', (err, data) => {
      if (data && data.common) {
        this.longitude = data.common.longitude;
        this.latitude = data.common.latitude;
      }
      this.scheduleSunsetSunrise();

      // update sunset/sunrise at midnight
      this.jobAtMidnight = Schedule.scheduleJob('1 0 * * *', (fireDate) => {
        this.scheduleSunsetSunrise();
        this.doMidnightJobs();
      })
    })

    if (this.extendedService) {
      await this.adapter.subscribeStates(this.CMD_ENERGY_OF_WEEK_ID);
      await this.adapter.subscribeStates(this.CMD_ENERGY_OF_MONTH_ID);
      await this.adapter.subscribeStates(this.CMD_ENERGY_OF_YEAR_ID);
    }
    await this.adapter.subscribeStates(this.CMD_POWER_OF_DAY_ID);
    await this.adapter.subscribeStates(this.POWER_OF_DAY_DATE_ID);
    await this.adapter.subscribeStates(this.CMD_START_STOP);

    // request list services 
    if (this.extendedService) {
      await this.adapter.setState(this.CMD_ENERGY_OF_WEEK_ID, true, false);
      await this.adapter.setState(this.CMD_ENERGY_OF_MONTH_ID, true, false);
      await this.adapter.setState(this.CMD_ENERGY_OF_YEAR_ID, true, false);
    }
    await this.adapter.setState(this.CMD_POWER_OF_DAY_ID, true, false);
    await this.adapter.setState(this.POWER_OF_DAY_DATE_ID, this.powerOfDayDate, true);
    await this.adapter.setState(this.SERVICE_COUNT_ID, this.serviceCount = 0, true);
    await this.adapter.setState(this.CMD_START_STOP, true, false);

    await this.adapter.log.debug(`Ecu.init() extendedService=${this.extendedService} - done`);
    this.ecuStateMachine('evInit');
  }

  /**
   * Stop and clean everything
   */
  unload() {
    this.jobAtMidnight.cancel();
    this.jobEndAtSunset.cancel();
    this.jobStartAtSunrise.cancel();
    this.ecuStateMachine('evUnload');
    this.adapter.log.debug('Ecu.unload() - done');
  }

  /**
   * Main Ecu state machine
   * - controls complete execution after initialization
   * - recursive called!
   * - controls 'info.connection'
   * 
   * @param {string} event 
   */
  async ecuStateMachine(event) {
    let oldState = this.ecuState;

    // error handling
    if (event === 'evSocketError' || event === 'evSocketTimeout' || event === 'evInvalidResponse') {
      this.adapter.log.debug(`Ecu.ecuStateMachine(${event}) ${oldState} -> ${this.ecuState}`)
      if (event === 'evSocketError') {
        this.adapter.log.error('Ecu.ecuStateMachine() +++ socket error');
      }
      else if (event === 'evSocketTimeout') {
        this.adapter.log.error('Ecu.ecuStateMachine() +++ socket timeout');
      }
      else if (event === 'evInvalidResponse') {
        this.adapter.log.error('Ecu.ecuStateMachine() +++ invalid response from Ecu');
      }
      this.ecuState = 'stWaitForDisconnected';
      this.adapter.setState(this.CONNECTION_ID, false, true);
      this.trDisconnect();
    } else if (event === 'evUnload') {
      this.ecuState = 'stUnload';
      this.adapter.log.debug(`Ecu.ecuStateMachine(${event}) ${oldState} -> ${this.ecuState}`)
      this.adapter.setState(this.CONNECTION_ID, false, true);
      this.trDisconnect();
    }

    switch (this.ecuState) {

      case 'stWaitForInit':
        if (event == 'evInit') {
          this.ecuState = 'stWaitForConnect';
          this.adapter.log.debug(`Ecu.ecuStateMachine(${event}) ${oldState} -> ${this.ecuState}`)
          this.trConnect();
        }
        break;

      case 'stWaitForConnect':
        if (event === 'evConnected') {
          this.adapter.setState(this.CONNECTION_ID, true, true);
          this.ecuState = 'stWaitForResponse';
          this.adapter.log.debug(`Ecu.ecuStateMachine(${event}) ${oldState} -> ${this.ecuState}`)
          this.trServiceSM2('evRepeatService');
        }
        break;

      case 'stWaitForResponse':
        if (event === 'evResponseOk') {
          this.ecuState = 'stWaitForDisconnected'; // xx
          this.adapter.log.debug(`Ecu.ecuStateMachine(${event}) ${oldState} -> ${this.ecuState}`)
          this.trDisconnect();  // xx
          // this.trServiceSM('evNextService'); // xx
        }
        else if (event === 'evResponseTimeout') {
          this.ecuState = 'stWaitForDisconnected'; // xx
          this.adapter.log.debug(`Ecu.ecuStateMachine(${event}) ${oldState} -> ${this.ecuState}`)
          //this.adapter.log.warn(`Ecu.ecuStateMachine() - no response from Ecu, repeat service ...`)
          this.adapter.log.warn(`Ecu.ecuStateMachine() - no response from Ecu, disconnect ...`)
          this.trDisconnect();
          //this.trServiceSM('evRepeatService');  
        }
        else if (event === 'evNoNextService') {
          this.ecuState = 'stWaitForDisconnected';
          this.adapter.log.debug(`Ecu.ecuStateMachine(${event}) ${oldState} -> ${this.ecuState}`)
          this.trDisconnect();
        }
        break;

      case 'stWaitForDisconnected':
        if (event === 'evDisconnected') {
          this.ecuState = 'stWaitForNextCycle';
          this.adapter.log.debug(`Ecu.ecuStateMachine(${event}) ${oldState} -> ${this.ecuState}`)
          this.trNextCycle();
        }
        break;

      case 'stWaitForNextCycle':
        if (event === 'evCycleTimer' || event === 'evCmdStart') {
          if (this.cmdStartStop) {
            this.ecuState = 'stWaitForConnect';
            this.adapter.log.debug(`Ecu.ecuStateMachine(${event}) ${oldState} -> ${this.ecuState}`)
            this.trConnect();
          }
          else {
            this.adapter.log.debug(`Ecu.ecuStateMachine(${event}) ${oldState} -> ${this.ecuState}`)
            this.trNextCycle();
          }
        }
        break;

      case 'stUnload':
        break;

      default:
        this.adapter.log.error('Ecu.ecuStateMachine() +++ invalid state')
        break;
    }
  }

  /**
    * Transaction: 
    * - establish TCP connection with Ecu
    * - install socket handler 
    */
  async trConnect() {

    clearTimeout(this.ecuPollIntervalTimeoutId);
    clearTimeout(this.rspWatchDogTimeoutId)

    this.client = new Net.Socket();

    this.client.on('error', (error) => {
      this.ecuStateMachine('evSocketError');
    });

    this.client.on('timeout', () => {
      this.ecuStateMachine('evSocketTimeout');
    });

    this.client.on('data', (ecuRsp) => {
      this.ecuStateMachine(this.decodeRsp(ecuRsp));
    });

    this.client.on('connect', () => {
      this.client.setKeepAlive(true, 1000);
      this.ecuStateMachine('evConnected');
    });

    this.client.connect(this.ecuPort, this.ecuIp, () => {
      ;
    });

    await this.adapter.log.debug(`Ecu.trConnect() hide=${this.hideEcuId}, ip=${this.ecuIp} port=${this.ecuPort}`);
  }

  /**
     * Transaction:
     * - Disconnect from Ecu 
     * - Chancel timers
     */
  async trDisconnect() {

    if (this.client) {
      this.client.end(() => {
        this.client = null;
      });
    }

    clearInterval(this.ecuPollIntervalTimeoutId);
    this.ecuPollIntervalTimeoutId = null;

    clearInterval(this.rspWatchDogTimeoutId);
    this.rspWatchDogTimeoutId = null;

    await this.adapter.log.debug('Ecu.trDisconnect() - done');
    this.ecuStateMachine('evDisconnected');
  }

  /**
   * Transaction:
   * - this is the complete service (request) state machine
   *  - it requests sequential the cyclic services:
   *    - SystemInfo-, RealTimeData-, InvertersSignalLevel-Service 
   *  - and the optional:
   *    - PowerOfDay-, and EnergyOfWeekMonthYear-Services
   * - to be called by ecuStateMachine() as submachine 
   * - it uses recursive calls with 'evRepeatService' to find next optional service
   * @param {string} event - 'evNextService', 'evRepeatService'
   */
  async trServiceSM2(event) {

    let oldServiceState = this.serviceState;

    if (this.serviceState === 'stSystemInfo' || this.ecuId == null) {
      await this.adapter.log.debug(`Ecu.trServiceSM2(${event}/${this.ecuId}) ${oldServiceState}->${this.serviceState}`);
      this.reqService('SYSTEMINFO', REQ_SYSTEMINFO + REQ_END + '\n');

      this.serviceState = 'stRealTimeData';
      await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
    }

    else if (this.serviceState === 'stRealTimeData') {
      await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
      this.reqService('REAL_TIME_DATA', REQ_REAL_TIME_DATA + this.ecuId + REQ_END + '\n');

      this.serviceState = 'stInverterSignalLevel';
      await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
    }

    else if (this.serviceState === 'stInverterSignalLevel') {
      await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
      this.reqService('INVERTER_SIGNAL_LEVEL', REQ_INVERTER_SIGNAL_LEVEL + this.ecuId + REQ_END + '\n');

      this.serviceState = 'stPowerOfDay';
      await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
    }


    else if (this.serviceState === 'stPowerOfDay') {
      if (this.cmdPowerOfDay) {
        let day = this.powerOfDayDate.substring(0, 4) + this.powerOfDayDate.substring(5, 7) + this.powerOfDayDate.substring(8, 10);
        const req = REQ_POWER_OF_DAY + this.ecuId + REQ_END + day + REQ_END + '\n';
        await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
        this.reqService('POWER_OF_DAY', req);
        this.serviceState = 'stEnergyOfWeek';
        await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
      }
      else {
        this.serviceState = 'stEnergyOfWeek';
        await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
        this.trServiceSM2('recursion');
      }
    }


    else if (this.serviceState === 'stEnergyOfWeek') {
      if (this.cmdEnergyOfWeek) {
        await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
        this.reqService('ENERGY_OF_WMY', REQ_ENERGY_OF_WMY + this.ecuId + REQ_END + REQ_WEEK + REQ_END + '\n');  // week
        this.serviceState = 'stEnergyOfMonth';
        await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
      }
      else {
        this.serviceState = 'stEnergyOfMonth';
        await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
        this.trServiceSM2('recursion');
      }
    }

    else if (this.serviceState === 'stEnergyOfMonth') {
      if (this.cmdEnergyOfMonth) {
        await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
        this.reqService('ENERGY_OF_WMY', REQ_ENERGY_OF_WMY + this.ecuId + REQ_END + REQ_MONTH + REQ_END + '\n');
        this.serviceState = 'stEnergyOfYear';
        await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
      }
      else {
        this.serviceState = 'stEnergyOfYear';
        await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
        this.trServiceSM2('recursion');
      }
    }

    else if (this.serviceState === 'stEnergyOfYear') {
      if (this.cmdEnergyOfYear) {
        await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
        this.reqService('ENERGY_OF_WMY', REQ_ENERGY_OF_WMY + this.ecuId + REQ_END + REQ_YEAR + REQ_END + '\n');
        this.serviceState = 'stSystemInfo';
        await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
      }
      else {
        this.serviceState = 'stSystemInfo';
        await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
        this.trServiceSM2('recursion');
      }
    }

    else {
      await this.adapter.log.error(`Ecu.trServiceSM2(${event}) +++ invalid state: ${oldServiceState}`);

      this.serviceState = 'stSystemInfo';
      await this.adapter.log.debug(`Ecu.trServiceSM2(${event}) ${oldServiceState}->${this.serviceState}`);
      this.trServiceSM2('recursion');
    }
  }

  /**
   * Transaction:
   * - create timeout for next cycle   
   */
  async trNextCycle() {
    this.ecuPollIntervalTimeoutId = setTimeout(() => {
      this.ecuStateMachine('evCycleTimer');
    }, this.ecuPollInterval * 1000);
    await this.adapter.log.debug(`Ecu.trNextCycle() ${this.ecuPollInterval}sec delay`)
  }

  /**
   * Midnight jobs 
   * - update total_energy_yesterday from current_day_energy
   *   - current_day energy is cleared by ECU
   * - update dc_peak_power_yesterday by dc_peak_power_today and reset dc_peak_power_today
   * - reset service_count
  */
  async doMidnightJobs() {
    let tmp_current_day_energy = (await this.adapter.getStateAsync(this.CURRENT_DAY_ENERGY)).val;
    await this.adapter.setState(this.TOTAL_ENERGY_YESTERDAY, tmp_current_day_energy, true);

    let tst_dc_peak_power_today;
    this.adapter.setState(this.DC_PEAK_POWER_YESTERDAY, tst_dc_peak_power_today = this.dc_peak_power_today, true);
    this.adapter.setState(this.DC_PEAK_POWER_TODAY, this.dc_peak_power_today = 0, true);

    this.adapter.setState(this.SERVICE_COUNT_ID, 0, true);
    this.adapter.log.debug(`Ecu.doMidnightJobs() - total_energy_yesterday=${tmp_current_day_energy}, dc_peak_power_yesterday=${tst_dc_peak_power_today}, service_count=0 ) - done`);
  }

  /**
   * Setup scheduler for sunrise and sunset actions
   * - sunrise/sunset - start/stop cyclic Ecu processing via CMD_START_STOP
   * - update states sunset, sunrise
   */
  scheduleSunsetSunrise() {
    let astroTime = SunCalc.getTimes(new Date(), this.latitude, this.longitude);

    if (this.jobStartAtSunrise) {
      this.jobStartAtSunrise.cancel();
    }
    if (this.jobEndAtSunset) {
      this.jobEndAtSunset.cancel();
    }

    let tmpObj = {};

    // schedule sunrise - start 
    tmpObj['hour'] = astroTime.sunrise.getHours() //- (this.astroTime.sunrise.getTimezoneOffset()/60);
    tmpObj['minute'] = astroTime.sunrise.getMinutes();
    this.adapter.setState(this.STATE_SUNRISE_ID, JSON.stringify(tmpObj), true);
    this.adapter.log.debug(`sunrise at ${JSON.stringify(tmpObj)}`);
    this.jobStartAtSunrise = Schedule.scheduleJob(tmpObj, (fireDate) => {
      this.adapter.setState(this.CMD_START_STOP, true, false);
      this.adapter.log.info(`schedule sunrise at ${fireDate}`);
    });

    // schedule sunset - stop
    tmpObj['hour'] = astroTime.sunset.getHours() //- (this.astroTime.sunset.getTimezoneOffset()/60);
    tmpObj['minute'] = astroTime.sunset.getMinutes();
    this.adapter.setState(this.STATE_SUNSET_ID, JSON.stringify(tmpObj), true);
    this.adapter.log.debug(`sunset at ${JSON.stringify(tmpObj)}`);
    this.jobEndAtSunset = Schedule.scheduleJob(tmpObj, (fireDate) => {
      this.adapter.setState(this.CMD_START_STOP, false, false);
      this.adapter.log.info(`schedule sunset at ${fireDate}`);
      //this.adapter.log.info(`schedule sunset at ${fireDate} poll_always=${this.pollAlways}`);
    });

    this.adapter.log.debug(`new scheduleSunSetSunrise() at ${new Date()}`);
  }

  /**
   * Command handler 
   * - cmdStartStop: control Ecu processing cycle
   *                 - start if waiting / stop at end of cycle
   * - set trigger for non cyclic service requests
   * @param {object id} id 
   * @param {object state} state 
   */
  async onStateChange(id, state) {

    await this.adapter.log.silly(`onStateChange() - id:${id} state:${state.val} ack:${state.ack}`);

    // trigger power_of_day service for new 'day' (CMD_POWER_OF_DAY will be used)
    if (id.includes(this.POWER_OF_DAY_DATE_ID)) {
      if (state.val != this.powerOfDayDate) {
        this.powerOfDayDate = state.val;
        this.adapter.setState(this.CMD_POWER_OF_DAY_ID, this.cmdPowerOfDay = true, false);
      }
    }

    // start/stop cyclic execution
    else if (id.includes(this.CMD_START_STOP)) {
      this.cmdStartStop = state.val;
      if (state.val === true) {
        if (state.ack === false) {
          // start new cycle if stWaitForNextCycle
          this.ecuStateMachine('evCmdStart');
          this.adapter.setState(this.CMD_START_STOP, true, true);
        }
      }
      else {
        if (state.ack === false) {
          this.adapter.setState(this.CMD_START_STOP, false, true);
        }
      }
    }

    // set trigger for requested services - checked and cleared by serviceSM()
    else {
      if (state.val == true) {
        if (id.includes(this.CMD_ENERGY_OF_WEEK_ID)) {
          this.cmdEnergyOfWeek = true;
        }
        else if (id.includes(this.CMD_ENERGY_OF_MONTH_ID)) {
          this.cmdEnergyOfMonth = true;
        }
        else if (id.includes(this.CMD_ENERGY_OF_YEAR_ID)) {
          this.cmdEnergyOfYear = true;
        }
        else if (id.includes(this.CMD_POWER_OF_DAY_ID)) {
          this.cmdPowerOfDay = true;
        };
      };
    };
  };

  /**
   * Request service from Ecu
   * @param {string} serviceInfo 
   * @param {string} req 
   */
  async reqService(serviceInfo, req) {
    this.rspWatchDogEnable();
    this.reqStartTime = new Date();
    this.client.write(req);
    let logReq = (this.hideEcuId && this.ecuId != null) ? req.replace(this.ecuId, '216000xxxxxx') : req;
    await this.adapter.log.debug(`Ecu.reqService(${serviceInfo} req:${logReq.substring(0, logReq.length - 1)})`);
  }

  /**
   * Enable service response timeout watch dog
   * - to be called before sending next service request
   */
  rspWatchDogEnable() {
    this.rspWatchDogDisable();
    this.rspWatchDogTimeoutId = setTimeout(() => {
      this.adapter.log.warn('rspWatchDog +++ timeout');
      // this.ecuStateMachine('evResponseTimeout'); xx
      this.ecuStateMachine('evResponseOk'); // xx
    }, ECU_RESPONSE_TIMOUT_MS);
  }

  /**
   * Disable service response watch dog
   * - to be called if data has been received from socket 
   */
  rspWatchDogDisable() {
    if (this.rspWatchDogTimeoutId != null) {
      clearTimeout(this.rspWatchDogTimeoutId);
      this.rspWatchDogTimeoutId = null;
    }
  }

  /**
   * Decode and Process Ecu response
   * @param {uint8 array} ecuRsp 
   * @returns 'evResponseOk' / 'evInvalidResponse' - valid/invalid response received
   * 
   * rev. 0.2.10 - 2
   */
  decodeRsp(ecuRsp) {
    let event = 'evResponseOk';
    let serviceTime = Date.now() - this.reqStartTime;
    this.rspWatchDogDisable();

    this.adapter.log.debug(`Ecu.decodeRsp() ${serviceTime}ms - ` + this.hideEcuIdInRsp(ecuRsp));
    let hdr = this.decodeHdr(ecuRsp); // 0.2.10 2023-10-09

    const idx = 13; // skip header
    switch (hdr.commandNumber) {
      case '0001': // systeminfo
        this.decodeAndProcessSystemInfo(ecuRsp.subarray(idx));
        break;
      case '0002': // realTimeData
        this.decodeAndProcessRealTimeData(ecuRsp.subarray(idx));
        break;
      case '0003': // power of day
        this.decodeAndProcessPowerOfDay(ecuRsp.subarray(idx));
        break;
      case '0004': // energy of month / week / year
        this.decodeAndProcessEnergyOfWMY(ecuRsp.subarray(idx), hdr.commandGroup);
        break;
      case '0030': // inverterSignalLevel
        this.decodeAndProcessInverterSignalLevel(ecuRsp.subarray(idx, idx + 999));
        break;
      default:
        this.adapter.log.error('Ecu.decodeRsp() +++ unknown commandNumber: ' + hdr.commandNumber);
        // event = 'evInvalidResponse'; xx
        event = 'evResponseOk'; // xx
        break;
    }
    return event;
  };

  /**
   * Hide ECU id in service response and skip trailing '\n'todo 
   * - only SystemInfo response (cmd='11') 
   * - 216000xxxxxx -> 216000000000
   * @param {uint8 array} rsp 
   * @returns modified response (e.c. for logging)
   */
  hideEcuIdInRsp(rsp) {
    let cRsp = Object.assign([], rsp);  // clone array without reference
    if (this.hideEcuId && cRsp[3] === 0x31 && cRsp[4] === 0x31) {
      for (let i = 0; i < 6; i++) {
        cRsp[13 + 6 + i] = 0x30;
      }
    }
    return bin2HexAscii(cRsp, cRsp.length - 1);
  }

  /** 
   * Check and decode header of any response
   * - check for 'protocol start/end signature' at start/end of response data to confirm data integrity
   *   - it's just a compromise!
   * - if check fails hdr.commandNuber = 'error'
   * @param {uint8 array} [rsp]
   * @returns - hdr 
   */
  decodeHdr(rsp) {
    let idx = 0;
    let hdr = {};

    let rspLen = rsp.length
    try {
      if (rspLen > 17) {  // hdr len + end signature len
        if (rsp.subarray(rspLen - 4).toString() === (REQ_END + '\n')) {
          hdr.signatureStart = rsp.subarray(idx, (idx += 3)).toString();
          if (hdr.signatureStart === 'APS') {
            hdr.commandGroup = rsp.subarray(idx, (idx += 2)).toString();
            hdr.frameLen = asciicd2int(rsp.subarray(idx, (idx += 4)));
            hdr.commandNumber = rsp.subarray(idx, (idx += 4)).toString();
          } else {
            throw '+++ invalid response: start signature missed'
          }
        } else {
          throw '+++ invalid response: end signature missed'
        }
      } else {
        throw `+++ invalid response: len=${rspLen}`;
      }
    } catch (e) {
      this.adapter.log.error(`Ecu.decodeHdr() - ${e}`);
      hdr.commandNumber = 'error';
    } finally {
      this.adapter.log.silly('HEADER: ' + JSON.stringify(hdr));
      return hdr; // 0.2.10 2023-10-09
    }
  }

  /** 
   * Decode and process SystemInfo response 
   * @param {uint8 array} [rsp]
   */
  decodeAndProcessSystemInfo(rsp) {
    let idx = 0;
    let sys = {};

    try {
      if (rsp.length >= 75) {  // only a rough len check (assumption: vlen=1 tzlen=1) 
        this.ecuId = rsp.subarray(idx, (idx += 12)).toString();
        sys.id = (this.hideEcuId && this.ecuId != null) ? '216000xxxxxx' : this.ecuId;
        sys.model = rsp.subarray(idx, (idx += 2)).toString();
        sys.lifeTimeEnergy = bin2int(rsp.subarray(idx, (idx += 4))) / 10;
        sys.lastSystemPower = bin2int(rsp.subarray(idx, (idx += 4)));
        sys.currentDayEnergy = bin2int(rsp.subarray(idx, (idx += 4))) / 100;
        sys.lastTimeConnectedEMA = bcd2str(rsp.subarray(idx, (idx += 7)));
        sys.inverters = bin2int(rsp.subarray(idx, (idx += 2)));
        sys.invertersOnline = bin2int(rsp.subarray(idx, (idx += 2)));
        sys.channel = rsp.subarray(idx, (idx += 2)).toString();
        sys.versionLen = asciicd2int(rsp.subarray(idx, (idx += 3)));
        sys.version = rsp.subarray(idx, (idx += sys.versionLen)).toString();
        sys.timeZoneLen = asciicd2int(rsp.subarray(idx, (idx += 3)));
        sys.timeZone = rsp.subarray(idx, (idx += sys.timeZoneLen)).toString();
        sys.ethernetMac = bcd2str(rsp.subarray(idx, (idx += 6)));
        sys.wirelessMac = bcd2str(rsp.subarray(idx, (idx += 6)));
        sys.signatureStop = rsp.subarray(idx, (idx += 3)).toString();

        this.adapter.log.silly('SYSTEM_INFO: ' + JSON.stringify(sys));

        this.adapter.setState('info.id', sys.id, true);
        this.adapter.setState('info.model', sys.model, true);
        this.adapter.setState('ecu.life_time_energy', sys.lifeTimeEnergy, true);
        this.adapter.setState('ecu.last_system_power', sys.lastSystemPower, true);
        this.adapter.setState(this.CURRENT_DAY_ENERGY, sys.currentDayEnergy, true);
        this.adapter.setState('info.version', sys.version, true);
        this.adapter.setState('info.timeZone', sys.timeZone, true);
        this.adapter.setState('ecu.inverters', sys.inverters, true);
        this.adapter.setState('ecu.inverters_online', sys.invertersOnline, true);
        this.adapter.setState(this.SERVICE_COUNT_ID, ++this.serviceCount, true);

        this.adapter.log.debug(`Ecu.decodeAndProcessSystemInfo() - version: ${sys.version} - done`);
      } // len >= 75
      else {
        throw `+++ too less data: len=${rsp.length}`;
      }
    }

    catch (e) {
      this.adapter.log.error(`Ecu.decodeAndProcessSystemInfo() ${e}`);
    } finally {
      ;
    }
  }

  /**
   * Decode and process RealTimeData response 
   * @param {uint8 array } [rsp]
   */
  decodeAndProcessRealTimeData(rsp) {
    let idx = 0;
    let rtd = {};
    //let inv = {}; // #1

    try {

      rtd.matchStatus = rsp.subarray(idx, (idx += 2)).toString();

      if (rtd.matchStatus == '00') {

        // remark: rsp len check is incomplete ...
        //         But start signature and end signature is checked by decodeHdr()
        //         Could be improved in the future
        if (rsp.length < 13) {
          throw `+++ invalid response: len=${rsp.length}`;
        }

        rtd.ecuModel = rsp.subarray(idx, (idx += 2)).toString();
        rtd.inverters = bin2int(rsp.subarray(idx, (idx += 2)));
        rtd.dateTime = bcd2JS_ISO_Date(rsp.subarray(idx, (idx += 7)));

        this.adapter.log.silly('REAL_TIME_DATA: ' + JSON.stringify(rtd));
        let tmp_total_dc_power = 0;

        // inverter loop .. rtd.inverter > 1 
        for (let i = 1; i <= rtd.inverters; i++) {
          let inv = {}; // #1
          this.adapter.log.silly(`Ecu.decodeAndProcessRealTimeData() - inverter loop: ${i}`);

          for (const prop of Object.getOwnPropertyNames(inv)) {
            delete inv[prop];
          }
          inv.dateTime = rtd.dateTime; // add dataTime to all inverter objects
          //inv.inverterIdType = asciicd2int(rsp.subarray(idx,idx+1));
          inv.inverterIdType = rsp[idx];
          inv.inverterId = bcd2str(rsp.subarray(idx, (idx += 6)));
          inv.state = bin2int(rsp.subarray(idx, (idx += 1)));
          inv.inverterType = rsp.subarray(idx, (idx += 2)).toString();

          if (inv.inverterType == "00") {
            inv.inverterIdType = INV_ID_TYPE_ONLY_REGISTERED;
          }

          switch (inv.inverterIdType) {
            case INV_ID_TYPE_YC600: // YC600 
            case INV_ID_TYPE_DS3:   // DS3
              inv.frequency = bin2int(rsp.subarray(idx, (idx += 2))) / 10.0;
              inv.temperature = bin2int(rsp.subarray(idx, (idx += 2))) - 100.0;
              inv.power1 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.voltage1 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.power2 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.voltage2 = bin2int(rsp.subarray(idx, (idx += 2)));
              /*
              if (inv.state != 1) {   // offline
                inv.power1 = inv.power2 = 0;
                inv.voltage1 = inv.voltage2 = 0;
              }
              */
              inv.dc_power = inv.power1 + inv.power2;
              tmp_total_dc_power += inv.dc_power;
              this.createAndSetInverterObjects(inv, (inv.inverterIdType == INV_ID_TYPE_YC600) ? INV_TYPE_STR_YC600 : INV_TYPE_STR_DS3);
              break;

            case INV_ID_TYPE_YC100: // YC1000 TODO not tested
              inv.frequency = bin2int(rsp.subarray(idx, (idx += 2))) / 10.0;
              inv.temperature = bin2int(rsp.subarray(idx, (idx += 2))) - 100.0;
              inv.power1 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.voltage1 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.power2 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.voltage2 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.power3 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.voltage3 = bin2int(rsp.subarray(idx, (idx += 2)));
              /*
              if (inv.state != 1) {   // clear invalid ecu data
                inv.power1 = inv.power2 = inv.power3 = 0;
                inv.voltage1 = inv.voltage2 = inv.voltage3 = 0;
              }
              */
              inv.dc_power = inv.power1 + inv.power2 + inv.power3 + inv.power4;
              tmp_total_dc_power += inv.dc_power;
              this.createAndSetInverterObjects(inv, INV_TYPE_STR_YC1000);

            case INV_ID_TYPE_QS1: // QS1
              inv.frequency = bin2int(rsp.subarray(idx, (idx += 2))) / 10.0;
              inv.temperature = bin2int(rsp.subarray(idx, (idx += 2))) - 100.0;
              inv.power1 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.voltage = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.power2 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.power3 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.power4 = bin2int(rsp.subarray(idx, (idx += 2)));
              /*
              if (inv.state != 1) {   // clear invalid ecu data
                inv.power1 = inv.power2 = inv.power3 = inv.power4 = 0;
                inv.voltage1 = inv.voltage2 = inv.voltage3 = inv.voltage4;
              }
              */
              inv.dc_power = inv.power1 + inv.power2 + inv.power3 + inv.power4;
              tmp_total_dc_power += inv.dc_power;
              this.createAndSetInverterObjects(inv, INV_TYPE_STR_QS1);
              break;

            case INV_ID_TYPE_ONLY_REGISTERED: // any type but only regstered at ECU
              //tmp_total_dc_power = 0; // ToDo BigPet
              this.adapter.log.debug(`ecu.decodeAndProcessRealTimeData() only registered - ${inv.inverterIdType} / ${inv.inverterId} `);
              break;

            default:
              throw `+++ invalid inverter type:${inv.inverterIdType} / ${inv.inverterId}`;
              break;
          } // end switch
          this.adapter.log.silly('REAL_TIME_DATA_INVERTER: ' + JSON.stringify(inv));
        } // end for

        if (this.dc_peak_power_today < tmp_total_dc_power) {
          this.adapter.setState(this.DC_PEAK_POWER_TODAY, this.dc_peak_power_today = tmp_total_dc_power, true);
        }

      } // end if matchStatus == OK
      else {
        this.adapter.log.warn(`ecu.decodeAndProcessRealTimeData() - no data: MatchStatus = ${rtd.matchStatus}`);
      }
    } catch (e) {
      this.adapter.log.error(`Ecu.decodeAndProcessRealTimeData() - ${e}`);
    } finally {
      ;
    }
  }

  /** 
   * Create and set all inverter specific objects
   * - objects created if not existing
   * - QS1, YC600/DS3, YC1000 supported
   * .../<inverterTypeStr>_<inverterId>/<states>
   *
   * @param {object} inv 
   * @param {string} inverterTypeStr 
   */
  async createAndSetInverterObjects(inv, inverterTypeStr) {
    let prefix = inverterTypeStr + '_' + inv.inverterId;

    let obj = await this.adapter.getStatesAsync(prefix + '.online');
    let createObjects = (Object.keys(obj).length === 0) ? true : false;

    await this.createInverterObjects(createObjects, prefix);
    await this.createInverterQs1Objects(createObjects, inverterTypeStr, prefix);
    await this.createInverterYc600AndDs3Objects(createObjects, inverterTypeStr, prefix);
    await this.createInverterYc1000Objects(createObjects, inverterTypeStr, prefix);

    this.inverterPrefixTable[inv.inverterId] = prefix;  // objects should be available now

    if (inverterTypeStr == INV_TYPE_STR_YC600 || inverterTypeStr == INV_TYPE_STR_YC1000 || inverterTypeStr == INV_TYPE_STR_QS1 || inverterTypeStr == INV_TYPE_STR_DS3) {
      this.adapter.setState(prefix + '.online', (inv.state == '01'), true);
      this.adapter.setState(prefix + '.inverter_id', inv.inverterId, true);
      this.adapter.setState(prefix + '.date_time', inv.dateTime, true);
      this.adapter.setState(prefix + '.frequency', inv.frequency, true);
      this.adapter.setState(prefix + '.temperature', inv.temperature, true);
      this.adapter.setState(prefix + '.dc_power1', parseInt(inv.power1), true);
      this.adapter.setState(prefix + '.dc_power2', parseInt(inv.power2), true);
    }

    if (inverterTypeStr == INV_TYPE_STR_YC600 || inverterTypeStr == INV_TYPE_STR_DS3) {
      this.adapter.setState(prefix + '.dc_power', inv.dc_power, true);
    }

    if (inverterTypeStr == INV_TYPE_STR_YC600 || inverterTypeStr == INV_TYPE_STR_YC1000 || inverterTypeStr == INV_TYPE_STR_DS3) {
      this.adapter.setState(prefix + '.ac_voltage1', parseInt(inv.voltage1), true);
      this.adapter.setState(prefix + '.ac_voltage2', parseInt(inv.voltage2), true);
    }

    if (inverterTypeStr == INV_TYPE_STR_YC1000) {
      this.adapter.setState(prefix + '.ac_voltage3', parseInt(inv.voltage3), true);
      this.adapter.setState(prefix + '.ac_voltage4', parseInt(inv.voltage4), true);
      this.adapter.setState(prefix + '.dc_power', inv.dc_power, true);
    }

    if (inverterTypeStr == INV_TYPE_STR_YC1000 || inverterTypeStr == INV_TYPE_STR_QS1) {
      this.adapter.setState(prefix + '.dc_power3', parseInt(inv.power3), true);
      this.adapter.setState(prefix + '.dc_power4', parseInt(inv.power4), true);
    }

    if (inverterTypeStr == INV_TYPE_STR_QS1) {
      this.adapter.setState(prefix + '.ac_voltage', parseInt(inv.voltage), true);
      this.adapter.setState(prefix + '.dc_power', inv.dc_power, true);
    }

    await this.adapter.setState(this.SERVICE_COUNT_ID, ++this.serviceCount, true);
    await this.adapter.log.debug(`ecu.createAndSetInverterObjects(${inverterTypeStr},${inv.inverterId}) - done`); // #1 debug output improved
  }


  /**
   * Decode and process PowerOfDay service response
   * @param {uint8 array} rsp
   */
  decodeAndProcessPowerOfDay(rsp) {
    let idx = 0;
    let pod = {};
    let pow = {};

    pod.status = rsp.subarray(idx, (idx += 2)).toString();
    if (pod.status == '00') {
      for (let len = rsp.subarray(idx).length - 2 - 4; len > 0; len -= 4) {
        pow[bcd2time(rsp.subarray(idx, (idx += 2)))] =
          bin2int(rsp.subarray(idx, (idx += 2))
          );
      }
      this.adapter.setState('ecu.power_of_day_list', JSON.stringify(pow), true);
      this.adapter.setState(this.CMD_POWER_OF_DAY_ID, this.cmdPowerOfDay = false, true);
      this.adapter.setState(this.POWER_OF_DAY_DATE_ID, this.powerOfDayDate, true);
      this.adapter.log.debug(`Ecu.decodeAndProcessPowerOfDay() - status=${pod.status} - done`);
    }
    else {
      this.adapter.log.warn(`Ecu.decodeAndProcessPowerOfDay() - status=${pod.status} != 00`);
    }
    this.adapter.setState(this.SERVICE_COUNT_ID, ++this.serviceCount, true);

    this.adapter.log.silly('POWER_OF_DAY: ' + JSON.stringify(pod));
    this.adapter.log.silly('POWER_OF_DAY: ' + JSON.stringify(pow));
  }

  /** 
   * Decode and process decodeAndProcessEnergyOfWMY service response
   * decode date, power pairs 
   * @param {uint8 array} [rsp]
   * @param {*} commandGroup '11' or '12' has to be checked by caller
   */
  decodeAndProcessEnergyOfWMY(rsp, commandGroup) {
    var idx = 0;
    let energy = {};
    let ewmy = {};
    const dateLen = 4;
    const powerLen = (commandGroup == '11') ? 2 : 4;

    energy.status = rsp.subarray(idx, (idx += 2)).toString();
    energy.wmy = rsp.subarray(idx, (idx += 2)).toString();

    if (energy.status == '00') {
      for (let len = rsp.subarray(idx).length - 4; len > 0; len -= (dateLen+powerLen)) {
        ewmy[bcd2datetime(rsp.subarray(idx, (idx += dateLen)))] = bin2int(rsp.subarray(idx, (idx += powerLen))) / 100;
      }
      switch (energy.wmy) {
        case '00':
          this.adapter.setState('ecu.energy_of_week_list', JSON.stringify(ewmy), true);
          this.adapter.setState(this.CMD_ENERGY_OF_WEEK_ID, this.cmdEnergyOfWeek = false, true);
          this.cmdEnergyOfWeek = false;
          break;
        case '01':
          this.adapter.setState('ecu.energy_of_month_list', JSON.stringify(ewmy), true);
          this.adapter.setState(this.CMD_ENERGY_OF_MONTH_ID, this.cmdEnergyOfMonth = false, true);
          this.cmdEnergyOfMonth = false;
          break;
        case '02':
          this.adapter.setState('ecu.energy_of_year_list', JSON.stringify(ewmy), true);
          this.adapter.setState(this.CMD_ENERGY_OF_YEAR_ID, this.cmdEnergyOfYear = false, true);
          this.cmdEnergyOfYear = false;
          break;
        default:
          this.adapter.log.error('ecu.decodeAndProcessEnergyOfWMY (' + energy.wmy + ') - bad');
          break;
      }
      this.adapter.setState(this.SERVICE_COUNT_ID, ++this.serviceCount, true);
      let period = (energy.wmy == '00') ? 'week' : (energy.wmy == '01') ? 'month' : 'year';

      this.adapter.log.silly('ENERGY_OF_WMY: ' + JSON.stringify(energy));
      this.adapter.log.silly('ENERGY_OF_WMY: ' + JSON.stringify(ewmy));
      this.adapter.log.debug(`Ecu.decodeAndProcessEnergyOfWMY() - wmy=${period} - done`);
    } // end if status == OK
    else {
      this.adapter.log.warn(`ecu.decodeAndProcessEnergyOfWMY() - no data: status = ${energy.status}`);
    }
  }

  /*
   * Decode and process InvertersSignalLevel service response
   */
  decodeAndProcessInverterSignalLevel(rsp) {
    var idx = 0;
    let isl = {};

    isl.status = rsp.subarray(idx, (idx += 2)).toString();
    if (isl.status == '00') {
      isl.inverterId = [];
      isl.level = [];
      isl.rssi = [];

      let i = 0;
      for (let len = rsp.subarray(idx).length - 2 - 7; len > 0; len -= 7, i++) {
        isl.inverterId[i] = bcd2str(rsp.subarray(idx, (idx += 6)));
        isl.level[i] = bin2int(rsp.subarray(idx, (idx += 1)));
        isl.rssi[i] = isl.level[i] - 256;

        let prefix = this.inverterPrefixTable[isl.inverterId[i]];
        this.adapter.log.debug(`prefix=` + prefix + ` i=` + i + ` isl.inverterId[i]=` + isl.inverterId[i]); // #1 debug output improved
        if (prefix) {
          this.adapter.setState(prefix + '.signal_level', isl.level[i], true);
          this.adapter.setState(prefix + '.rssi', isl.rssi[i], true);
        }
      }
      this.adapter.log.debug(`Ecu.decodeAndProcessInverterSignalLevel() - status=${isl.status} - done`);
    }
    else {
      this.adapter.log.warn(`Ecu.decodeAndProcessInverterSignalLevel() - status=${isl.status} != '00'`);
    }
    this.adapter.setState(this.SERVICE_COUNT_ID, ++this.serviceCount, true);

    this.adapter.log.silly('INVERTER_SIGNAL_LEVEL: ' + JSON.stringify(isl));  // #1 debug output improved
  }

  /*
   * Create all static objects
   * - <adapter>/ecu/<states>
   * - <adapter>/info/<states>
   */
  async createStaticObjects() {

    await this.adapter.setObjectNotExists('ecu', {
      type: 'device',
      common: {
        name: 'ECU related states',
      },
      native: {},
    });

    await this.adapter.setObjectNotExists(this.CMD_START_STOP, {
      type: 'state',
      common: {
        name: 'start/stop cyclic service execution',
        role: 'state',
        type: 'boolean',
        read: true,
        write: true,
        def: true,
      },
      native: {},
    });

    if (this.extendedService) {

      await this.adapter.setObjectNotExists(this.CMD_ENERGY_OF_WEEK_ID, {
        type: 'state',
        common: {
          name: 'request energy_of_week service',
          role: 'state',
          type: 'boolean',
          read: true,
          write: true,
          def: false,
        },
        native: {},
      });


      await this.adapter.setObjectNotExists(this.CMD_ENERGY_OF_MONTH_ID, {
        type: 'state',
        common: {
          name: 'request energy_of_month service',
          role: 'state',
          type: 'boolean',
          read: true,
          write: true,
          def: false,
        },
        native: {},
      });

      await this.adapter.setObjectNotExists(this.CMD_ENERGY_OF_YEAR_ID, {
        type: 'state',
        common: {
          name: 'request energy_of_year service',
          role: 'state',
          type: 'boolean',
          read: true,
          write: true,
          def: false,
        },
        native: {},
      });
    } // energyOfWMYServices

    await this.adapter.setObjectNotExists(this.CMD_POWER_OF_DAY_ID, {
      type: 'state',
      common: {
        name: 'request power_of_day service',
        role: 'state',
        type: 'boolean',
        read: true,
        write: true,
        def: false,
      },
      native: {},
    });

    await this.adapter.setObjectNotExists(this.POWER_OF_DAY_DATE_ID, {
      type: 'state',
      common: {
        name: '"day" used for power_of_day service',
        role: 'state',
        type: 'string',
        read: true,
        write: true,
        def: '',
      },
      native: {},
    });

    await await this.adapter.setObjectNotExists(this.STATE_SUNRISE_ID, {
      type: 'state',
      common: {
        name: 'sunrise time used to start cyclic service execution',
        role: 'json',
        type: 'string',
        read: true,
        write: false,
        def: '{}',
      },
      native: {},
    });

    await this.adapter.setObjectNotExists(this.STATE_SUNSET_ID, {
      type: 'state',
      common: {
        name: 'sunset time used to stop cyclic service execution',
        role: 'json',
        type: 'string',
        read: true,
        write: false,
        def: '{}',
      },
      native: {},
    });

    await this.adapter.setObjectNotExists('info.id', {
      type: 'state',
      common: {
        name: 'ECU serial number',
        role: 'value',
        type: 'string',
        read: true,
        write: false,
        def: '',
      },
      native: {},
    });

    await this.adapter.setObjectNotExists('info.version', {
      type: 'state',
      common: {
        name: 'ECU firmware version',
        role: 'info.firmware',
        type: 'string',
        read: true,
        write: false,
        def: '',
      },
      native: {},
    });

    await this.adapter.setObjectNotExists('info.timeZone', {
      type: 'state',
      common: {
        name: 'ECU time zone',
        role: 'text',
        type: 'string',
        read: true,
        write: false,
        def: '',
      },
      native: {},
    });

    await this.adapter.setObjectNotExists(this.SERVICE_COUNT_ID, {
      type: 'state',
      common: {
        name: 'counts successful service executions (request-response) by ECU',
        role: 'value',
        type: 'number',
        read: true,
        write: false,
        def: 0,
      },
      native: {},
    });

    await this.adapter.setObjectNotExists('ecu.inverters', {
      type: 'state',
      common: {
        name: 'number of configured inverters',
        role: 'value',
        type: 'number',
        read: true,
        write: false,
        def: 0,
      },
      native: {},
    });

    await this.adapter.setObjectNotExists('ecu.inverters_online', {
      type: 'state',
      common: {
        name: 'number of inverters online',
        role: 'value',
        type: 'number',
        read: true,
        write: false,
        def: 0,
      },
      native: {},
    });

    await this.adapter.setObjectNotExists('info.model', {
      type: 'state',
      common: {
        name: 'ECU model code',
        role: 'text',
        type: 'string',
        read: true,
        write: false,
        def: 'unknown',
      },
      native: {},
    });

    await this.adapter.setObjectNotExists('ecu.life_time_energy', {
      type: 'state',
      common: {
        name: 'total life_time_energy',
        role: 'value.power',
        type: 'number',
        unit: 'kWh',
        read: true,
        write: false,
        def: 0,
      },
      native: {},
    });

    await this.adapter.setObjectNotExists('ecu.last_system_power', {
      type: 'state',
      common: {
        name: 'last_power_value received',
        role: 'value.power',
        type: 'number',
        unit: 'W',
        read: true,
        write: false,
        def: 0,
      },
      native: {},
    });

    await this.adapter.setObjectNotExists(this.CURRENT_DAY_ENERGY, {
      type: 'state',
      common: {
        name: 'energy_of_day current value',
        role: 'value.power',
        type: 'number',
        unit: 'kWh',
        read: true,
        write: false,
        def: 0,
      },
      native: {},
    });

    await this.adapter.setObjectNotExists(this.TOTAL_ENERGY_YESTERDAY, {
      type: 'state',
      common: {
        name: 'total energy yesterday',
        role: 'value.power',
        type: 'number',
        unit: 'kWh',
        read: true,
        write: false,
        def: 0,
      },
      native: {},
    });

    await this.adapter.setObjectNotExists(this.DC_PEAK_POWER_TODAY, {
      type: 'state',
      common: {
        name: 'dc peak power of the day',
        role: 'value.power',
        type: 'number',
        unit: 'W',
        read: true,
        write: false,
        def: 0,
      },
      native: {},
    });

    await this.adapter.setObjectNotExists(this.DC_PEAK_POWER_YESTERDAY, {
      type: 'state',
      common: {
        name: 'dc peak power yesterday',
        role: 'value.power',
        type: 'number',
        unit: 'W',
        read: true,
        write: false,
        def: 0,
      },
      native: {},
    });

    await this.adapter.setObjectNotExists('ecu.power_of_day_list', {
      type: 'state',
      common: {
        name: 'list of power values at power_of_day_date ',
        role: 'json',
        def: '{}',
        unit: 'W',
        type: 'string',
        read: true,
        write: false,
      },
      native: {},
    });

    if (this.extendedService) {

      await this.adapter.setObjectNotExists('ecu.energy_of_week_list', {
        type: 'state',
        common: {
          name: 'list of energy values for last seven days',
          role: 'json',
          def: '{}',
          unit: 'kWh',
          type: 'string',
          read: true,
          write: false,
        },
        native: {},
      });

      await this.adapter.setObjectNotExists('ecu.energy_of_month_list', {
        type: 'state',
        common: {
          name: 'list of daily energy values for last 30 days',
          role: 'json',
          def: '{}',
          unit: 'kWh',
          type: 'string',
          read: true,
          write: false,
        },
        native: {},
      });

      await this.adapter.setObjectNotExists('ecu.energy_of_year_list', {
        type: 'state',
        common: {
          name: 'list of monthly energy values for last twelve months)',
          role: 'json',
          def: '{}',
          unit: 'kWh',
          type: 'string',
          read: true,
          write: false,
        },
        native: {},
      });

    } // end if energyOfWMYServices

    await this.adapter.log.debug(`Ecu.createStaticObjects() - done`);
  }

  /**
   * Create common objects for QS1, YC600 and YC1000 inverter type
   * @param {boolean} createObjects - true/false: create objects/ already created
   * @param {string} prefix - device object id
   */
  async createInverterObjects(createObjects, prefix) {
    if (!createObjects) {
      this.adapter.log.silly(`Ecu.createInverterObjects(${createObjects}, ${prefix}) done`);
      return;
    }
    this.adapter.log.debug(`Ecu.createInverterObjects(${prefix}) creating ...`);

    await this.adapter.setObjectNotExists(prefix, {
      type: 'device',
      common: {
        name: 'organizes states for specific inverter',
      },
      native: {},
    })

    await this.adapter.setObjectNotExists(
      prefix + '.online',
      {
        type: 'state',
        common: {
          name: 'ECU to inverter connection state',
          role: 'indicator.connected',
          def: false,
          type: 'boolean',
          read: true,
          write: false,
        },
        native: {},
      }
    )

    await this.adapter.setObjectNotExists(
      prefix + '.date_time',
      {
        type: 'state',
        common: {
          name: '"date-time" of last received real time data',
          role: 'value.time',
          def: 'unknown',
          type: 'string',
          read: true,
          write: false,
        },
        native: {},
      }
    )

    await this.adapter.setObjectNotExists(
      prefix + '.signal_level',
      {
        type: 'state',
        common: {
          name: 'signal strength of ECU inverter connection',
          role: 'value',
          def: 0,
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );
    
    await this.adapter.setObjectNotExists(
      prefix + '.rssi',
      {
        type: 'state',
        common: {
          name: 'signal strength of ECU inverter connection',
          role: 'value',
          def: 0,
          unit: 'dBm',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.inverter_id',
      {
        type: 'state',
        common: {
          name: 'inverter serial number',
          role: 'info.serial',
          def: 'unknown',
          type: 'string',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.frequency',
      {
        type: 'state',
        common: {
          name: 'ac frequency',
          role: 'value',
          def: 0,
          unit: 'Hz',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.temperature',
      {
        type: 'state',
        common: {
          name: 'temperature',
          role: 'value.temperature',
          def: 0,
          unit: '°C',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.dc_power',
      {
        type: 'state',
        common: {
          name: 'total dc power',
          role: 'value.power',
          def: 0,
          unit: 'W',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.log.debug(`Ecu.createInverterObjects(${createObjects}, ${prefix}) done`);
  }

  /**
   * Create objects for QS1 inverter type
   * @param {boolean} createObjects - true/false: create objects/ already created
   * @param {string} inverterTypeStr - inverter type as string
   * @param {string} prefix - device object id
   */
  async createInverterQs1Objects(createObjects, inverterTypeStr, prefix) {
    if (!createObjects || inverterTypeStr != INV_TYPE_STR_QS1) {
      this.adapter.log.silly(`Ecu.createInverterQs1Objects(${createObjects}, ${prefix}) done`);
      return;
    }
    this.adapter.log.debug(`Ecu.createInverterQs1Objects(${prefix}) creating ...`);

    await this.adapter.setObjectNotExists(
      prefix + '.ac_voltage',
      {
        type: 'state',
        common: {
          name: 'ac voltage',
          role: 'value.voltage',
          def: 0,
          unit: 'V',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.dc_power1',
      {
        type: 'state',
        common: {
          name: 'dc power module 1',
          role: 'value.power',
          def: 0,
          unit: 'W',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.dc_power2',
      {
        type: 'state',
        common: {
          name: 'dc power module 2',
          role: 'value.power',
          def: 0,
          unit: 'W',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.dc_power3',
      {
        type: 'state',
        common: {
          name: 'dc power module 3',
          role: 'value.power',
          def: 0,
          unit: 'W',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.dc_power4',
      {
        type: 'state',
        common: {
          name: 'dc power module 4',
          role: 'value.power',
          def: 0,
          unit: 'W',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    this.adapter.log.debug(`Ecu.createInverterQs1Objects(${createObjects}, ${prefix}) done`);
  }

  /**
   * Create objects for YC600 inverter type
   * @param {boolean} createObjects - true/false: create objects/ already created
   * @param {string} inverterTypeStr - inverter type as string
   * @param {string} prefix - device object id
   */
  async createInverterYc600AndDs3Objects(createObjects, inverterTypeStr, prefix) {
    if (!createObjects || ((inverterTypeStr != INV_TYPE_STR_YC600) && (inverterTypeStr != INV_TYPE_STR_DS3))) {
      this.adapter.log.silly(`Ecu.createInverterYc600AndDs3Objects(${createObjects}, ${prefix}) - ${inverterTypeStr} already done`);
      return;
    }
    this.adapter.log.debug(`Ecu.createInverterYc600AndDs3Objects(${prefix}) creating ...`);

    await this.adapter.setObjectNotExists(
      prefix + '.dc_power1',
      {
        type: 'state',
        common: {
          name: 'dc power module 1',
          role: 'value.power',
          def: 0,
          unit: 'W',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.dc_power2',
      {
        type: 'state',
        common: {
          name: 'dc power module 2',
          role: 'value.power',
          def: 0,
          unit: 'W',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.ac_voltage1',
      {
        type: 'state',
        common: {
          name: 'ac voltage module 1',
          role: 'value.voltage',
          def: 0,
          unit: 'V',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.ac_voltage2',
      {
        type: 'state',
        common: {
          name: 'ac voltage module 2',
          role: 'value.voltage',
          def: 0,
          unit: 'V',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.log.debug(`Ecu.createInverterYc600AndDs3Objects(${createObjects}, ${prefix}) done`);
  }

  /**
   * Create objects for YC1000 inverter type
   * @param {boolean} createObjects - true/false: create objects/ already created
   * @param {string} inverterTypeStr - inverter type as string
   * @param {string} prefix - device object id
   */
  async createInverterYc1000Objects(createObjects, inverterTypeStr, prefix) {
    if (!createObjects || inverterTypeStr != INV_TYPE_STR_YC1000) {
      this.adapter.log.silly(`Ecu.createInverterYc100Objects(${createObjects}, ${prefix}) done`);
      return;
    }
    this.adapter.log.debug(`ecu.createInverterYc100Objects(${prefix}) ...`);

    await this.adapter.setObjectNotExists(
      prefix + '.dc_power1',
      {
        type: 'state',
        common: {
          name: 'dc power module 1',
          role: 'value.power',
          def: 0,
          unit: 'W',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.dc_power2',
      {
        type: 'state',
        common: {
          name: 'dc power module 2',
          role: 'value.power',
          def: 0,
          unit: 'W',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.dc_power3',
      {
        type: 'state',
        common: {
          name: 'dc power module 3',
          role: 'value.power',
          def: 0,
          unit: 'W',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.dc_power4',
      {
        type: 'state',
        common: {
          name: 'dc power module 4',
          role: 'value.power',
          def: 0,
          unit: 'W',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.ac_voltage1',
      {
        type: 'state',
        common: {
          name: 'ac voltage module 1',
          role: 'value.voltage',
          def: 0,
          unit: 'V',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.ac_voltage2',
      {
        type: 'state',
        common: {
          name: 'ac voltage module 2',
          role: 'value.voltage',
          def: 0,
          unit: 'V',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.setObjectNotExists(
      prefix + '.ac_voltage3',
      {
        type: 'state',
        common: {
          name: 'ac voltage module 3',
          role: 'value.voltage',
          def: 0,
          unit: 'V',
          type: 'number',
          read: true,
          write: false,
        },
        native: {},
      }
    );

    await this.adapter.log.debug(`Ecu.createInverterYc100Objects(${createObjects}, ${prefix}) done`);
  }


} // end clas Ecu


// Conversion utilities ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

/**
 * Convert binary data into array with hexadecimal ASCII chars
 * e.c. [95, 80, 83, ...] -> [65, 80, 83, ]
 * @param {uint8 array} buf - with binary data
 * @returns array with hexadecimal ASCII representation (without prefix 0x)
 */
function bin2HexAscii(buf, len) {
  let byte = '';
  for (let i = 0; i < len; i++) {
    byte += String.fromCharCode(parseInt(buf[i], 16).toString(16));
  }
  var hexarrayout = [];
  for (let i = 0; i < byte.length; i++) {
    hexarrayout.push(byte.charCodeAt(i).toString(16));
  }
  return hexarrayout;
}

/**
 * Convert decimal number represented as ASCII into integer number
 * e.c. [48, 48, 57, 52] -> 94 
 * @param {uint8 array} buf - decimal numbers as ASCII
 * @returns - number as integer
 */
function asciicd2int(buf) {
  let intVal = 0;
  buf.forEach((element) => {
    intVal = intVal * 10 + element - 48;
  });
  return intVal;
}

/**
 * Convert binary coded decimal data into decimal number as string
 * e.c. [128, 151, 27, 1, 204, 123 ] -> '8097111011212711'
 * @param {uint8 array} buf - binary coded decimal data
 * @returns decimal number as string 
 */
function bcd2str(buf) {
  let bcdStr = '';
  buf.forEach((elem) => {
    bcdStr += (elem >> 4).toString();
    bcdStr += (elem & 0x0f).toString();
  });
  return bcdStr;
}


/**
 * Convert binary coded date time data into date time string
 * e.c. [32, 33, 17, 8] -> '2021.11.08'
 * Format: 'yyyy.mm.dd' or 'yyyy.mm.dd_hh:mm:ss'
 * @param {uint8 array} buf - binary coded date time data
 * @returns date time as string
 */
function bcd2datetime(buf) {
  let str = bcd2str(buf);
  let datetimeStr = str.substring(0, 4) + '.' + // year
    str.substring(4, 6) + '.' + // month
    str.substring(6, 8); // day
  if (str.length > 8) {
    datetimeStr +=
      '-' +
      str.substring(8, 10) +
      ':' + // hour
      str.substring(10, 12) +
      ':' + // minute
      str.substring(12, 14); // second
  }
  return datetimeStr;
}

/**
 * Convert binary coded date time data into ISO date time string
 * e.c. [0x20, 0x21, 0x10, 0x30, 0x20, 0x30, 0x00] -> Sat Oct 30 2021 20:30:00 GMT+...
 * @param {uint8 array} buf - binary coded date time data
 * @returns date time ISO string 
 */
function bcd2JS_ISO_Date(buf) {
  let str = bcd2str(buf);
  return new Date(
    parseInt(str.substring(0, 4)),     // year 
    parseInt(str.substring(4, 6)) - 1,  // month
    parseInt(str.substring(6, 8)),     // day
    parseInt(str.substring(8, 10)),    // hour
    parseInt(str.substring(10, 12)),   // minute
    parseInt(str.substring(12, 14))    // second
  ).toISOString();
}

/**
 * Convert binary code time data to time string
 * e.c. [7, 65] -> '07:41'
 * @param {uint8 array} buf - binary coded time data
 * @returns  time as string
 */
function bcd2time(buf) {
  let str = bcd2str(buf);
  let timeStr =
    str.substring(0, 2) +
    ':' + // hh
    str.substring(2, 4); // mm

  return timeStr;
}

/**
 * Convert binary data to integer number 
 * e.c. [1, 32] -> 288
 * @param {uint8 array} buf - binary data
 * @returns converted data as integer number
 */
function bin2int(buf) {
  let intVal = 0;
  buf.forEach((element) => {
    intVal = (intVal << 8) | element;
  });
  return intVal;
}


// todo export interface 
module.exports = { Ecu };
