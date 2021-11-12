'use strict';
//const { getAbsoluteInstanceDataDir } = require('@iobroker/adapter-core');
const SunCalc = require('suncalc2');
const Schedule = require('node-schedule');
const Net = require('net');


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

const ECU_RESPONSE_TIMOUT_MS = 2000;


/*
*/
class Ecu {
  CMD_ENERGY_OF_WEEK_ID = 'ecu.cmd_energy_of_week';
  CMD_ENERGY_OF_MONTH_ID = 'ecu.cmd_energy_of_month';
  CMD_ENERGY_OF_YEAR_ID = 'ecu.cmd_energy_of_year';
  CMD_POWER_OF_DAY_ID = 'ecu.cmd_power_of_day';
  POWER_OF_DAY_DATE_ID = 'ecu.power_of_day_date';
  CMD_START_STOP = 'ecu.cmd_start_stop';
  STATE_SUNSET = 'info.sunset';
  STATE_SUNRISE = 'info.sunrise';

  /** 
   * Initialize Ecu - part 1
   * @param {*} adapter
   */
  constructor(adapter) {
    this.adapter = adapter;
    this.ecuId = null;  // ID of ECU if known
  
    // timer and interval
    this.nextCycleTimeoutId = null;
    this.rspWatchDogTimeoutId = null;

    this.client = null;
    this.inverterPrefixTable = {}; // inverter id : object prefix table

    this.reqStartTime = null;
    this.serviceTime = 0;
    this.serviceCount = 0;    

    this.hideEcuId = true;
    this.ecuIp = '';
    this.ecuPort = 8899;
    this.longitude = 50.11552;
    this.latitude = 8.68417;

    this.state = 'stWaitForInit';
    this.serviceState = 'stSystemInfo';

    // command triggers
    this.cmdEnergyOfWeek = true;
    this.cmdEnergyOfMonth = true;
    this.cmdEnergyOfYear = true;
    this.cmdPowerOfDay = true;
    this.powerOfDayDate = (new Date()).toISOString().substring(0,10);
    this.cmdStartStop = true;

    // schedules
    this.jobStartAtSunrise = null;
    this.jobEndAtSunset = null;
    this.jobAtMidnight = null;
  }

  /**
   * Initialize Ecu - part 2
   * - Finalize initialization and call ecuStateMachine()
   * 
   */
  async init() {
    this.hideEcuId = this.adapter.config.hide_ecu_id ? true : false;
    this.ecuIp = this.adapter.config.ecu_ip;
    this.ecuPort = this.adapter.config.ecu_port;
    this.ecuId = null;

    await this.createStaticObjects();
    this.adapter.getForeignObject('system.config', (err, data) => {
      if (data && data.common) {
          this.longitude = data.common.longitude;
          this.latitude = data.common.latitude; 
      }
      this.scheduleSunsetSunrise();
      
      // update sunset/sunrise at midnight
      this.jobAtMidnight = Schedule.scheduleJob( '1 0 * * *', (fireDate) => {
        this.scheduleSunsetSunrise();
      })

      // always start cyclic service execution at adapter start
      this.adapter.setState(this.CMD_START_STOP, true, false);
    })

    await this.adapter.subscribeStates(this.CMD_ENERGY_OF_WEEK_ID); 
    await this.adapter.subscribeStates(this.CMD_ENERGY_OF_MONTH_ID);
    await this.adapter.subscribeStates(this.CMD_ENERGY_OF_YEAR_ID);
    await this.adapter.subscribeStates(this.CMD_POWER_OF_DAY_ID);    
    await this.adapter.subscribeStates(this.POWER_OF_DAY_DATE_ID);   
    await this.adapter.subscribeStates(this.CMD_START_STOP);    

    // request list services 
    await this.adapter.setState(this.CMD_ENERGY_OF_WEEK_ID, true, false);
    await this.adapter.setState(this.CMD_ENERGY_OF_MONTH_ID, true, false);
    await this.adapter.setState(this.CMD_ENERGY_OF_YEAR_ID, true, false);
    await this.adapter.setState(this.CMD_POWER_OF_DAY_ID, true, false);
    await this.adapter.setState(this.POWER_OF_DAY_DATE_ID, this.powerOfDayDate, true);
    await this.adapter.setState('info.service_count', this.serviceCount = 0, true);  
    await this.adapter.setState(this.CMD_START_STOP, true, false);  


    await this.adapter.log.debug('Ecu.init() - done');
    this.ecuStateMachine('evInit');
  }

  /**
   * 
   */
  unload() {
    this.ecuStateMachine('evUnload');
    this.adapter.log.debug('Ecu.unload() - done');
  }
   
  /**
   * Main Ecu state machine
   * - controls complete execution after initialization
   * - recursive called!
   * 
   * @param {*} event 
   */
  ecuStateMachine(event) {
    let oldState = this.state ;
    this.adapter.log.debug(`ecuStateMachine(${event}) state=${this.state}`)

    if (event === 'evSocketError' || event === 'evSocketTimeout' || event === 'evInvalidResponse') {
      this.state = 'stWaitForDisconnected';
      this.trDisconnect();
    } else if (event === 'evUnload') {
      this.state = 'stUnload';
      this.trDisconnect();
    }

    switch (this.state) {

      case 'stWaitForInit':
        if ( event == 'evInit') {
          this.state = 'stWaitForConnect';
          this.trConnect();
        }
        break;

      case 'stWaitForConnect':
        if (event === 'evConnected') {
          this.state = 'stWaitForResponse';
          this.trServiceSM('evRepeatService');
        }
        break;

      case 'stWaitForResponse':
        if (event === 'evResponseOk') {
          this.trServiceSM('evNextService'); 
        } 
        else if (event === 'evResponseTimeout') {
          this.trServiceSM('evRepeatService');  
        }
        else if (event === 'evNoNextService') {
          this.state = 'stWaitForDisconnected';
          this.trDisconnect();  
        }
        break;

      case 'stWaitForDisconnected':
        if (event === 'evDisconnected') {
          this.state = 'stWaitForNextCycle';
          this.trNextCycle();          
        }
        break;

      case 'stWaitForNextCycle':
        if (event === 'evCycleTimer' || event === 'evCmdStart') {
          if (this.cmdStartStop) {
            this.state = 'stWaitForConnect';
            this.trConnect();
          }
          else {
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
    * - connect  with Ecu
    * - install socket handler 
    */
  async trConnect() {

    clearTimeout(this.nextCycleTimeoutId);
    clearTimeout(this.rspWatchDogTimeoutId)

    this.client = new Net.Socket();

    this.client.on('error', (error) => {
      this.ecuStateMachine('evSocketError'); 
    });

    this.client.on('timeout', () => {
      this.ecuStateMachine('evSocketTimeout');
    });

    this.client.on('data', (ecuRsp) => {
      let serviceTime = Date.now() - this.reqStartTime;
      this.ecuStateMachine(this.decodeRsp(ecuRsp)); 
     });

    this.client.on('connect', () => {
      this.adapter.setState('info.connection', true, true);
      this.adapter.setState(this.CMD_START_STOP, true, true);       
      this.client.setKeepAlive(true, 1000);
      this.ecuStateMachine('evConnected');
    });

    this.client.connect(this.ecuPort, this.ecuIp, () => {
      ;
    } );       
  
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
        this.adapter.setState('info.connection', false, true);      
        this.adapter.setState(this.CMD_START_STOP, false, true);  
      });
    }         

    clearInterval(this.rspWatchDogTimeoutId);
    this.rspWatchDogTimeoutId = null;      

    await this.adapter.log.debug('Ecu.trDisconnect() - done');   
    this.ecuStateMachine('evDisconnected');
  }

  /**
   * Transaction:
   * - this is the complete service (request) state machine
   * - to be called by Ecu state machine only
   * @param {*} event 
   */
  async trServiceSM(event) {

    let oldServiceState = this.serviceState; 

    if (this.serviceState === 'stSystemInfo' || this.ecuId == null) {
      if (event == 'evRepeatService' || this.ecuId == null) {
        this.reqService('SYSTEMINFO', REQ_SYSTEMINFO + REQ_END + '\n');
        await this.adapter.log.debug(`trServiceSM(${event}/${this.ecuId}) ${oldServiceState}->${this.serviceState}`);
      }
      else {
        this.serviceState = 'stRealTimeData';
        this.reqService('REAL_TIME_DATA', REQ_REAL_TIME_DATA + this.ecuId + REQ_END + '\n');        
        await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
      }
    }

    else if (this.serviceState === 'stRealTimeData') {
      if (event == 'evRepeatService') {
        this.reqService('REAL_TIME_DATA', REQ_REAL_TIME_DATA + this.ecuId + REQ_END + '\n');        
        await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
      }
      else {
        this.serviceState = 'stInverterSignalLevel';
        this.reqService('INVERTER_SIGNAL_LEVEL', REQ_INVERTER_SIGNAL_LEVEL + this.ecuId + REQ_END + '\n');    
        await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
      }
    }

    else if (this.serviceState === 'stInverterSignalLevel') {
      if (event == 'evRepeatService') {
        this.reqService('INVERTER_SIGNAL_LEVEL', REQ_INVERTER_SIGNAL_LEVEL + this.ecuId + REQ_END + '\n');    
        await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
      }
      else {
        if (this.cmdPowerOfDay) {
          this.serviceState = 'stPowerOfDay';
          let day = this.powerOfDayDate.substring(0,4) + this.powerOfDayDate.substring(5,7) + this.powerOfDayDate.substring(8,10);
          const req = REQ_POWER_OF_DAY + this.ecuId + REQ_END + day + REQ_END + '\r';      
          this.reqService('POWER_OF_DAY', req);   
          this.cmdPowerOfDay = false;
          await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
        }
        else {
          this.serviceState = 'stEnergyOfWeek';
          this.trServiceSM('evRepeatService');
          await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
        }
      }
    }

    else if (this.serviceState === 'stPowerOfDay') {
      if (event == 'evRepeatService') {
        let day = this.powerOfDayDate.substring(0,4) + this.powerOfDayDate.substring(5,7) + this.powerOfDayDate.substring(8,10);
        const req = REQ_POWER_OF_DAY + this.ecuId + REQ_END + day + REQ_END + '\r';      
        this.reqService('POWER_OF_DAY', req);   
        await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
      }
      else {
        if (this.cmdEnergyOfWeek) {
          this.serviceState = 'stEnergyOfWeek';
          this.reqService('ENERGY_OF_WMY', REQ_ENERGY_OF_WMY + this.ecuId + REQ_END + REQ_WEEK + REQ_END + '\n');  // week
          this.cmdEnergyOfWeek = false;
          await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
        }
        else {
          this.serviceState = 'stEnergyOfMonth';
          this.trServiceSM('evRepeatService');
          await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
        }
      }
    }

    else if (this.serviceState === 'stEnergyOfWeek') {
      if (event == 'evRepeatService') {
        this.reqService('ENERGY_OF_WMY', REQ_ENERGY_OF_WMY + this.ecuId + REQ_END + REQ_WEEK + REQ_END + '\n');  // week
        await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
      }
      else {
        if (this.cmdEnergyOfMonth) {
          this.serviceState = 'stEnergyOfMonth';
          this.reqService('ENERGY_OF_WMY', REQ_ENERGY_OF_WMY + this.ecuId + REQ_END + REQ_MONTH + REQ_END + '\n');
          this.cmdEnergyOfMonth = false;
          await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
        }
        else {
          this.serviceState = 'stEnergyOfYear';
          this.trServiceSM('evRepeatService');
          await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
        }
      }
    }

    else if (this.serviceState === 'stEnergyOfMonth') {
      if (event == 'evRepeatService') {
        this.reqService('ENERGY_OF_WMY', REQ_ENERGY_OF_WMY + this.ecuId + REQ_END + REQ_MONTH + REQ_END + '\n');  // week
        await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
      }
      else {
        if (this.cmdEnergyOfYear) {
          this.serviceState = 'stEnergyOfYear';
          this.reqService('ENERGY_OF_WMY', REQ_ENERGY_OF_WMY + this.ecuId + REQ_END + REQ_YEAR + REQ_END + '\n');
          this.cmdEnergyOfYear = false;
          await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
        }
        else {
          this.serviceState = 'stSystemInfo';
          await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
          this.ecuStateMachine('evNoNextService');          
        }
      }
    }

    else if (this.serviceState === 'stEnergyOfYear') {
      if (event == 'evRepeatService') {
        this.reqService('ENERGY_OF_WMY', REQ_ENERGY_OF_WMY + this.ecuId + REQ_END + REQ_MONTH + REQ_END + '\n');  // week
        await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
      }
      else {
        this.serviceState = 'stSystemInfo';
        await this.adapter.log.debug(`trServiceSM(${event}) ${oldServiceState}->${this.serviceState}`);
        this.ecuStateMachine('evNoNextService');
      }
    }

    else {
      await this.adapter.log.error(`trServiceSM(${event}) +++ invalid state: ${oldServiceState}`);
    }
  }

  /**
   * Transaction:
   * - todo
   */
  async trNextCycle() {
    // TODO config
    let intervalMsec = 10000;
    // intervalSec min 20sec, default 75sec
    let _intervalMsec = 75 * 1000;
    if ( typeof(intervalMsec) === 'number' && intervalMsec != null ) {
      _intervalMsec = (intervalMsec < 10000) ? 10000 : intervalMsec;
    } 

    this.nextCycleTimeoutId = setTimeout( () => {
      // if sun
      // 
      this.ecuStateMachine('evCycleTimer');
    }, _intervalMsec);
    await this.adapter.log.debug(`trNextCycle() ${_intervalMsec/1000}s`)
  }

  /**
   * Setup scheduler for sunrise and sunset events
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
   this.adapter.setState(this.STATE_SUNRISE, JSON.stringify(tmpObj), true);
   this.adapter.log.debug(`sunrise at ${JSON.stringify(tmpObj)}`);    
   this.jobStartAtSunrise = Schedule.scheduleJob(tmpObj, (fireDate) => {
     this.adapter.setState(this.CMD_START_STOP, true, false);
     this.adapter.log.info(`schedule sunrise at ${fireDate}`);
   });
  
   // schedule sunset - stop
   tmpObj['hour'] = astroTime.sunset.getHours() //- (this.astroTime.sunset.getTimezoneOffset()/60);
   tmpObj['minute'] = astroTime.sunset.getMinutes();
   this.adapter.setState(this.STATE_SUNSET, JSON.stringify(tmpObj), true);
   this.adapter.log.debug(`sunset at ${JSON.stringify(tmpObj)}`);        
   this.jobEndAtSunset = Schedule.scheduleJob(tmpObj, (fireDate) => {
     this.adapter.setState(this.CMD_START_STOP, false, false);
     this.adapter.log.info(`schedule sunset at ${fireDate}`);
   });  
  
   this.adapter.log.debug(`new scheduleSunSetSunrise() at ${new Date()}`);        
  }

  /**
   * Command handler 
   * - cmdStartStop: control Ecu processing cycle
   *                 - start if waiting / stop at end of cycle
   * - set trigger for non cyclic service requests
   * @param {*} id 
   * @param {*} state 
   */
   async onStateChange(id, state) {
 
    await this.adapter.log.info(`id:${id} state:${state.val}`);

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
      if ( state.val === 'true' ) {
          if (state.ack === false) {  
            await this.adapter.log.info('cmdStartStop: true, false');           
            // start new cycle if stWaitForNextCycle
            this.ecuStateMachine('evCmdStart');     
            this.adapter.setState(this.CMD_START_STOP, true, true);   
          }     
      }
      else {
        if (state.ack === false) {
          this.adapter.setState(this.CMD_START_STOP, false, true);            
        }
        await this.adapter.log.info('cmdStartStop: false, true');           
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
   * @param {*} serviceInfo 
   * @param {*} req 
   */
  async reqService(serviceInfo, req) {
    this.rspWatchDogEnable();
    this.reqStartTime = new Date();
    this.client.write(req);
    await this.adapter.log.debug(`Ecu.reqService(${serviceInfo} req:${((this.hideEcuId && this.ecuId != null) ? 
                                  req.replace(this.ecuId, '216000xxxxxx') : 
                                  req)})`);
  }

 /**
  * Enable service response timeout watch dog
  * - to be called before sending next service request
  */
  rspWatchDogEnable() {
    this.rspWatchDogDisable();
    this.rspWatchDogTimeoutId = setTimeout( () => {
      this.adapter.log.warn('rspWatchDog - timeout');    
      this.ecuStateMachine('evResponseTimeout');
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
   * @param {*} ecuRsp 
   */
  decodeRsp(ecuRsp) {
    let event = 'evResponseOk';
    
    this.adapter.log.debug('Ecu.decodeRsp:' + bin2HexAscii(this.hideEcuIdInRsp(ecuRsp)));
    this.rspWatchDogDisable();     

    const idx = 13; // skip header
    switch (this.decodeHdr(ecuRsp)) {
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
        this.decodeAndProcessEnergyOfWMY(ecuRsp.subarray(idx));
        break;
      case '0030': // inverterSignalLevel
        this.decodeAndProcessInverterSignalLevel(ecuRsp.subarray(idx, idx + 999));
        break;
      default:
        this.adapter.log.error('decodeRsp: +++unknown commandNumber: ' + commandNumber);
        event = 'evInvalidResponse';
        break;
    }

    return event;
  };

  /**
   * Hide ECU id in service response 
   * - only SystemInfo response (cmd='11') 
   * - 216000xxxxxx -> 216000000000
   * @param {*} rsp 
   * @returns modified response (e.c. for logging)
   */
  hideEcuIdInRsp(rsp) {
    if (this.hideEcuId && (rsp.subarray(3,5).toString() == '11')) {
      let cRsp = Object.assign([], rsp);  // clone array without reference
      for (let i=0; i<6; i++) {
        cRsp[13+6+i] = 0x30;
      }
      return cRsp;
    } else {
      return rsp;
    }
  }

  /*
   * Check and decode header of any response
   * - check for 'protocol start/end signature' at start/end of response data to confirm data integrity
   *   - it's just a compromise!
   * @param {*} [rsp]
   * @returns - commandNumber or 'error'
   */
  decodeHdr(rsp) {
    let idx = 0;
    let hdr = {};

    let rspLen = rsp.length
    try {
      if (rspLen > 17) {  // hdr len + end signature len
        if (rsp.subarray(rspLen-4).toString() === (REQ_END + '\n') ) {
          hdr.signatureStart = rsp.subarray(idx, (idx += 3)).toString();
          if (hdr.signatureStart === 'APS' ) {
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
      //this.showObj(hdr, 'hdr.', 'hdr.signatureStart'.length);
      return hdr.commandNumber;
    }   
 }

  /*
   * Decode and process SystemInfo response 
   * @param {*} [rsp]
   */
  decodeAndProcessSystemInfo(rsp) {
    let idx = 0;
    let sys = {};

    // TODO len
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

    //this.showObj(sys, 'hdr.', 'sys.lastTimeConnectedEMA'.length);

    this.adapter.setState('info.id', sys.id, true);
    this.adapter.setState('info.model', sys.model, true);
    this.adapter.setState('ecu.life_time_energy', sys.lifeTimeEnergy, true);
    this.adapter.setState('ecu.last_system_power', sys.lastSystemPower, true);
    this.adapter.setState('ecu.current_day_energy', sys.currentDayEnergy, true);
    this.adapter.setState('info.version', sys.version, true);
    this.adapter.setState('info.timeZone', sys.timeZone, true);
    this.adapter.setState('ecu.inverters', sys.inverters, true);
    this.adapter.setState('ecu.inverters_online', sys.invertersOnline, true);
    this.adapter.setState('info.service_count', ++this.serviceCount, true);  

    this.adapter.log.debug('Ecu.decodeAndProcessSystemInfo() - done');
  }

  /*
   * Decode and process RealTimeData response 
   * @param { } [res]
   */
  decodeAndProcessRealTimeData(rsp) {
    let idx = 0;
    let rtd = {};
    let inv = {};

    try {
      // remark: rsp len check is incomplete ...
      //         But start signature and end signature is checked by decodeHdr()
      //         Could be improved in the future
      if (rsp.length < 13) {
        throw `+++ invalid response: len=${rsp.len}`;
      }

      rtd.matchStatus = rsp.subarray(idx, (idx += 2)).toString(); 
      rtd.ecuModel = rsp.subarray(idx, (idx += 2)).toString();
      rtd.inverters = bin2int(rsp.subarray(idx, (idx += 2)));
      rtd.dateTime = bcd2JS_ISO_Date(rsp.subarray(idx, (idx += 7)));

      if (rtd.matchStatus = '00') { // semantic not clear

        // inverter loop .. rtd.inverter > 1 
        for (let i = 1; i <= rtd.inverters; i++) {
          this.adapter.log.silly(`Ecu.decodeAndProcessRealTimeData() - inverter loop: ${i}`);    

          for (const prop of Object.getOwnPropertyNames(inv)) {
            delete inv[prop];
          }
          inv.dateTime = rtd.dateTime; // at dataTime to all inverter objects
          inv.inverterId = bcd2str(rsp.subarray(idx, (idx += 6)));
          inv.state = bin2int(rsp.subarray(idx, (idx += 1)));
          inv.inverterType = rsp.subarray(idx, (idx += 2)).toString();
          inv.frequency = bin2int(rsp.subarray(idx, (idx += 2))) / 10.0;
          inv.temperature = bin2int(rsp.subarray(idx, (idx += 2))) - 100.0;
              
          switch (inv.inverterType) {
            case '01': // YC600 TODO not tested
              inv.power1 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.voltage1 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.power2 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.voltage2 = bin2int(rsp.subarray(idx, (idx += 2)));
              this.createAndSetInverterObjects(inv, INV_TYPE_STR_YC600);                  
              break;
            case '02': // YC1000 TODO not tested
              inv.power1 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.voltage1 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.power2 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.voltage2 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.power3 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.voltage3 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.power4 = bin2int(rsp.subarray(idx, (idx += 2)));
              if (inv.state != 1) {   // clear invalid ecu data
                inv.power1 = inv.power2 = inv.power3 = inv.power4 = 0;
              }
              this.createAndSetInverterObjects(inv, INV_TYPE_STR_YC1000);             

            case '03': // QS1
              inv.power1 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.voltage = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.power2 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.power3 = bin2int(rsp.subarray(idx, (idx += 2)));
              inv.power4 = bin2int(rsp.subarray(idx, (idx += 2)));
              if (inv.state != 1) {   // clear invalid ecu data
                inv.power1 = inv.power2 = inv.power3 = inv.power4 = 0;
              }
              this.createAndSetInverterObjects(inv, INV_TYPE_STR_QS1); 
              break;

            default:
              throw `+++ invalid inverter type:${inv.inverterType}`;
              break;
          } // end switch
        } // end for
      } // end if matchStatus
    } catch (e) {
      this.adapter.log.error(`Ecu.decodeAndProcessRealTimeData() - ${e}`);    
    } finally {
      ;
    }
  }

  /*
   * Create and set all inverter specific objects
   * - objects created if not existing
   * - QS1, YC600, YC1000 supported
   * .../<inverterTypeStr>_<inverterId>/<states>
  */
  async createAndSetInverterObjects(inv, inverterTypeStr) {
    let prefix = inverterTypeStr + '_' + inv.inverterId;
    this.inverterPrefixTable[inv.inverterId] = prefix;

    let obj = await this.adapter.getStatesAsync(prefix + '.online');
    let createObjects = (Object.keys(obj).length === 0) ? true : false;

    await this.createInverterObjects(createObjects, prefix);
    await this.createInverterQs1Objects(createObjects, inverterTypeStr, prefix);
    await this.createInverterYc60Objects(createObjects, inverterTypeStr, prefix);
    await this.createInverterYc1000Objects(createObjects, inverterTypeStr, prefix);

    if (inverterTypeStr == INV_TYPE_STR_YC600 || inverterTypeStr == INV_TYPE_STR_YC1000 || inverterTypeStr == INV_TYPE_STR_QS1 ) {
      this.adapter.setState(prefix + '.online', (inv.state == '01'), true); 
      this.adapter.setState(prefix + '.inverter_id', inv.inverterId, true);
      this.adapter.setState(prefix + '.date_time', inv.dateTime, true);
      this.adapter.setState(prefix + '.frequency', inv.frequency, true);
      this.adapter.setState(prefix + '.temperature',inv.temperature,true);
      this.adapter.setState(prefix + '.dc_power1',parseInt(inv.power1),true);
      this.adapter.setState(prefix + '.dc_power2',parseInt(inv.power2),true);
    }

    if (inverterTypeStr == INV_TYPE_STR_YC600) {
      this.adapter.setState(prefix + '.dc_power', inv.power1 + inv.power2, true);  
    }

    if (inverterTypeStr == INV_TYPE_STR_YC600 || inverterTypeStr == INV_TYPE_STR_YC1000) {
      this.adapter.setState(prefix + '.dc_voltage1',parseInt(inv.voltage1),true);
      this.adapter.setState(prefix + '.dc_voltage2',parseInt(inv.voltage2),true);
    }

    if (inverterTypeStr == INV_TYPE_STR_YC1000) {
      this.adapter.setState(prefix + '.dc_voltage3',parseInt(inv.voltage3),true);
      this.adapter.setState(prefix + '.dc_voltage4',parseInt(inv.voltage4),true);
      this.adapter.setState(prefix + '.dc_power', inv.power1 + inv.power2 + inv.power3, true);        
    }

    if (inverterTypeStr == INV_TYPE_STR_YC1000 || inverterTypeStr == INV_TYPE_STR_QS1) {
      this.adapter.setState(prefix + '.dc_power3',parseInt(inv.power3),true);
      this.adapter.setState(prefix + '.dc_power4',parseInt(inv.power4),true);
    }

    if (inverterTypeStr == INV_TYPE_STR_QS1) {
      this.adapter.setState(prefix + '.ac_voltage',parseInt(inv.voltage),true);
      this.adapter.setState(prefix + '.dc_power',inv.power1 + inv.power2 + inv.power3 + inv.power4,true);    
    }

    this.adapter.log.debug(`ecu.createAndSetInverterObjects(${inverterTypeStr}) - done` );
  }
  

  /*
   * Decode and process PowerOfDay service response
   * @param {} []
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
      this.adapter.setState(this.CMD_POWER_OF_DAY_ID, this.cmdPowerOfDay=false, true);
      this.adapter.setState(this.POWER_OF_DAY_DATE_ID, this.powerOfDayDate, true);
      this.adapter.log.debug(`Ecu.decodeAndProcessPowerOfDay() - status=${pod.status} - done`);
     } 
     else {      
      this.adapter.log.warn(`Ecu.decodeAndProcessPowerOfDay() - status=${pod.status} != 00`);
    }
    this.adapter.setState('info.service_count', ++this.serviceCount, true);  
    //this.showObj(pod, 'pod.', 'pod.status'.length);
 }

  /*
   * Decode and process decodeAndProcessEnergyOfWMY service response
   * @param {} [rsp]
   */
  decodeAndProcessEnergyOfWMY(rsp) {
    var idx = 0;
    let energy = {};
    let ewmy = {};

    energy.status = rsp.subarray(idx, (idx += 2)).toString();
    energy.wmy = rsp.subarray(idx, (idx += 2)).toString();

    if (energy.status == '00') {
      for (let len = rsp.subarray(idx).length - 4; len > 0; len -= 6) {
        ewmy[bcd2datetime(rsp.subarray(idx, (idx += 4)))] = bin2int(rsp.subarray(idx, (idx += 2))) / 100;
      }
      switch (energy.wmy) {
        case '00':
          this.adapter.setState('ecu.energy_of_week_list', JSON.stringify(ewmy), true);
          this.adapter.setState(this.CMD_ENERGY_OF_WEEK_ID, this.cmdEnergyOfWeek=false, true);
          break;
        case '01':
          this.adapter.setState('ecu.energy_of_month_list', JSON.stringify(ewmy), true);
          this.adapter.setState(this.CMD_ENERGY_OF_MONTH_ID, this.cmdEnergyOfMonth=false, true);
          break;
        case '02':
          this.adapter.setState('ecu.energy_of_year_list', JSON.stringify(ewmy), true);
          this.adapter.setState(this.CMD_ENERGY_OF_YEAR_ID, this.cmdEnergyOfYear=false, true);
          break;
       default:
          this.adapter.log.error('Ecu.decodeAndProcessEnergyOfWMY (' + energy.wmy + ') - bad');
          break;
      }    
    }

    //this.showObj(energy, 'energy.', 'energy.wmy'.length);
    //this.showObj(ewmy);
    this.adapter.setState('info.service_count', ++this.serviceCount, true);  
    this.adapter.log.debug(`Ecu.decodeAndProcessEnergyOfWMY() - wmy=${energy.wmy} - done`);
  }

  /*
   * Decode and process InvertersSignalLevel service response
   */
  decodeAndProcessInverterSignalLevel(rsp) {
    var idx = 0;
    let isl = {};

    isl.status = rsp.subarray(idx, (idx += 2)).toString();
    if (isl.status == '00') {

      for (let len = rsp.subarray(idx).length - 2 - 7; len > 0; len -= 7) {
        isl.inverterId = bcd2str(rsp.subarray(idx, (idx += 6)));
        isl.level = bin2int(rsp.subarray(idx, (idx += 1)));
  
        let prefix = this.inverterPrefixTable[isl.inverterId];
        if (prefix) {
          this.adapter.setState(prefix + '.signal_level', isl.level, true);  
        }    
      }
      this.adapter.log.debug(`Ecu.decodeAndProcessInverterSignalLevel() - status=${isl.status} - done`);
    } 
    else {
      this.adapter.log.warn(`Ecu.decodeAndProcessInverterSignalLevel() - status=${isl.status} != '00'`);
    }
    this.adapter.setState('info.service_count', ++this.serviceCount, true);  
    //this.showObj(isl, 'isl.', 'isl.inverterId'.length);
  }

  /*
   * Create all static objects
   * <adapter>/ecu/<states>
   * <adapter>/info/<states>
   * <adapter>/inverters
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

    await await this.adapter.setObjectNotExists(this.STATE_SUNRISE, { 
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

    await this.adapter.setObjectNotExists(this.STATE_SUNSET, { 
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

    await this.adapter.setObjectNotExists('info.service_count', {
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

    await this.adapter.setObjectNotExists('ecu.current_day_energy', {
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

    await this.adapter.log.debug(`Ecu.createStaticObjects() - done`);
  }
  

  /**
   * TODO
   * @param {*} createObjects 
   * @param {*} prefix 
   * @returns 
   */
  async createInverterObjects(createObjects, prefix) {
    if (!createObjects) {
      this.adapter.log.silly(`Ecu.createInverterObjects(${createObjects}, ${prefix}) done` );    
      return;
    }
    this.adapter.log.debug(`Ecu.createInverterObjects(${prefix}) creating ...` );

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

    this.adapter.log.debug(`Ecu.createInverterObjects(${createObjects}, ${prefix}) done` );   
  } 

  async createInverterQs1Objects(createObjects, inverterTypeStr, prefix) {
    if (!createObjects || inverterTypeStr != INV_TYPE_STR_QS1) {
      this.adapter.log.silly(`Ecu.createInverterQs1Objects(${createObjects}, ${prefix}) done` );    
      return;
    }
    this.adapter.log.debug(`Ecu.createInverterQs1Objects(${prefix}) creating ...` );

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

    this.adapter.log.debug(`Ecu.createInverterQs1Objects(${createObjects}, ${prefix}) done` );   
  } 

async createInverterYc60Objects(createObjects, inverterTypeStr, prefix) {
  if (!createObjects || inverterTypeStr != INV_TYPE_STR_YC600 ) {
    this.adapter.log.silly(`Ecu.createInverterYc60Objects(${createObjects}, ${prefix}) done` );    
    return;
  }
  this.adapter.log.debug(`Ecu.createInverterYc60Objects(${prefix}) creating ...` );

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
    prefix + '.dc_voltage1',
    {
      type: 'state',
      common: {
        name: 'dc voltage module 1',
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
    prefix + '.dc_voltage2',
    {
      type: 'state',
      common: {
        name: 'dc voltage module 2',
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

  this.adapter.log.debug(`Ecu.createInverterYc60Objects(${createObjects}, ${prefix}) done` ); 
}

async createInverterYc1000Objects(createObjects, inverterTypeStr, prefix) {
  if (!createObjects || inverterTypeStr != INV_TYPE_STR_YC1000) {
    this.adapter.log.silly(`Ecu.createInverterYc100Objects(${createObjects}, ${prefix}) done` );    
    return;
  }
  this.adapter.log.debug(`ecu.createInverterYc100Objects(${prefix}) ...` );


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
    prefix + '.dc_voltage1',
    {
      type: 'state',
      common: {
        name: 'dc voltage module 1',
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
    prefix + '.dc_voltage2',
    {
      type: 'state',
      common: {
        name: 'dc voltage module 2',
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
    prefix + '.dc_voltage3',
    {
      type: 'state',
      common: {
        name: 'dc voltage module 3',
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

  this.adapter.log.debug(`Ecu.createInverterYc100Objects(${createObjects}, ${prefix}) done` ); 
}


// Utilities ===================================================================================================


/*
 */
showObj(obj, prefix, len) {
  console.log(obj.toString());
  for (const [key, value] of Object.entries(obj)) {
    const str = (prefix + key + 
                '                                               ').substr(0, len) + ': ' + value;
    console.log(str);
  }
}

/*
 */
showArray(arr) {
  arr.forEach((elem) => console.log(elem));
}

}

/*
 */
function bin2HexAscii(str) {
  let byte = '';
  for (let i = 0; i < str.length; i++) {
    byte += String.fromCharCode(parseInt(str[i], 16).toString(16));
  }

  var hexarrayout = [];
  for (let i = 0; i < byte.length; i++) {
    hexarrayout.push(byte.charCodeAt(i).toString(16));
  }

  return hexarrayout;
}

function asciicd2int(buf) {
  let intVal = 0;
  buf.forEach((element) => {
    intVal = intVal * 10 + element - 48;
  });
  return intVal;
}

function bcd2str(buf) {
  let bcdStr = '';
  buf.forEach((elem) => {
    bcdStr += (elem >> 4).toString();
    bcdStr += (elem & 0x0f).toString();
  });
  return bcdStr;
}

/*
  yyyy.mm.dd_hh:mm:ss
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
 * Convert 'binary code decimal date time' into 'JavaScript Date' as ISO string
 *  E.c. [0x20, 0x21, 0x10, 0x30, 0x20, 0x30, 0x00] -> Sat Oct 30 2021 20:30:00 GMT+...
 * @param {Uint8Array} buf 
 * @returns Date
 */
function bcd2JS_ISO_Date(buf) {
  let str = bcd2str(buf);
  return new Date(
    parseInt(str.substring(0,4)),     // year 
    parseInt(str.substring(4,6)) -1,  // month
    parseInt(str.substring(6,8)),     // day
    parseInt(str.substring(8,10)),    // hour
    parseInt(str.substring(10,12)),   // minute
    parseInt(str.substring(12,14))    // second
  ).toISOString();
}

/*
 */
function bcd2time(buf) {
  let str = bcd2str(buf);
  let timeStr =
    str.substring(0, 2) +
    ':' + // hh
    str.substring(2, 4); // mm

  return timeStr;
}

function bin2int(buf) {
  let intVal = 0;
  buf.forEach((element) => {
    intVal = (intVal << 8) | element;
  });
  return intVal;
}


// todo export interface 
module.exports = { Ecu };
