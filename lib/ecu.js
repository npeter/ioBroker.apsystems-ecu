'use strict';
//const { getAbsoluteInstanceDataDir } = require('@iobroker/adapter-core');
const SunCalc = require('suncalc2');
const schedule = require('node-schedule');
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
   * @param {todo} adapter

   */
  constructor(adapter) {
    this.adapter = adapter;
    this.ecuId = null;  // ID of ECU or null!
    this.cyclicRequestsTimeoutId = null;
    this.rspWatchDogTimeoutId = null;
    this.writeTimeoutId = null;
    this.client = null;
    this.inverterPrefixTable = {}; // inverter id : object prefix table
    this.waitForResponse = false;
    this.connected = false; 
    this.reqStartTime = null;
    this.serviceTime = 0;
    this.hideEcuId = true;
    this.serviceCount = 0;

    this.cmdEnergyOfWeek = true;
    this.cmdEnergyOfMonth = true;
    this.cmdEnergyOfYear = true;
    this.cmdPowerOfDay = true;
    this.powerOfDayDate = (new Date()).toISOString().substring(0,10);

    this.JobStart = null;
    this.JobEnd = null;
  }

  init() {

    /*
    let systemConfig = this.adapter.getForeignObject('system.config', () => {
      this.adapter.console.log.debug(`latitude: ${systemConfig.common.latitude}`);
      this.adapter.console.log.debug(`longitude: ${systemConfig.common.longitude}`);     
    });
*/
    //this.adapter.log.debug(Object.keys(this.adapter));
    this.createStaticObjects();        
    this.scheduleSunsetSunrise();

    this.jobMidnight = schedule.scheduleJob( '42 21 * * *', (fireDate) => {
      this.scheduleSunsetSunrise();
    })
  }

  scheduleSunsetSunrise() {
    //this.astroTime =  SunCalc.getTimes(new Date(), this.adapter.config.latitude, this.adapter.config.longitude);
    this.astroTime =  SunCalc.getTimes(new Date(), 49, 10);
    if (this.jobStart) {
      this.jobStart.cancel();      
    }
    if (this.jobEnd) {
      this.jobEnd.cancel();     
    }
    let tmpObj = {};
    tmpObj['hour'] = this.astroTime.sunrise.getHours() //- (this.astroTime.sunrise.getTimezoneOffset()/60);
    tmpObj['minutes'] = this.astroTime.sunrise.getMinutes();
    this.adapter.setState(this.STATE_SUNRISE, JSON.stringify(tmpObj), true);
    this.adapter.log.debug(`sunrise at ${JSON.stringify(tmpObj)}`);    

    this.jobStart = schedule.scheduleJob(tmpObj, (fireDate) => {
      this.adapter.setState(this.CMD_START_STOP, true, false);
      this.adapter.log.info(`schedule sunrise at ${fireDate}`);
    });

    tmpObj['hour'] = this.astroTime.sunset.getHours() //- (this.astroTime.sunset.getTimezoneOffset()/60);
    tmpObj['minutes'] = this.astroTime.sunset.getMinutes();
    this.adapter.setState(this.STATE_SUNSET, JSON.stringify(tmpObj), true);
    this.adapter.log.debug(`sunset at ${JSON.stringify(tmpObj)}`);        

    this.jobEnd = schedule.scheduleJob(tmpObj, (fireDate) => {
      this.adapter.setState(this.CMD_START_STOP, false, false);
      this.adapter.log.info(`schedule sunset at ${fireDate}`);
    });  


    this.adapter.log.debug(`scheduleSunSetSunrise() at ${new Date()}`);        
  }



  /*
   * Establish ECU connection
   * Install socket event handlers
   * Install handler for cyclic services
   */
  async start(ip, port) {
    // check ip and port todo
    if (!this.connected) {
      this.ecuId = null;
      this.client = new Net.Socket();
  
      // request list services 
      this.adapter.setState(this.CMD_ENERGY_OF_WEEK_ID, true, true);
      this.adapter.setState(this.CMD_ENERGY_OF_MONTH_ID, true, true);
      this.adapter.setState(this.CMD_ENERGY_OF_YEAR_ID, true, true);
      this.adapter.setState(this.CMD_POWER_OF_DAY_ID, true, true);
      this.adapter.setState(this.POWER_OF_DAY_DATE_ID, this.powerOfDayDate, true);
  
      // install handlers
      this.client.on('error', (error) => {
        this.adapter.log.error('Ecu.client.on("error") - socket error: ' + error);
        this.stop(); 
      });
  
      this.client.on('timeout', () => {
        this.adapter.log.error('Ecu.client.on("timeout") - socket timeout');
        this.stop();
      });
  
      this.client.on('data', (ecuRsp) => {
        let serviceTime = Date.now() - this.reqStartTime;
        this.rspWatchDogDisable();       
        this.adapter.log.debug(`Ecu.client.on('data') - serviceTime=${serviceTime}`);
        this.decodeRsp(ecuRsp); 
       });
  
      this.client.on('connect', () => {
        this.connected = true;
        this.adapter.setState('info.connection', true, true);
        this.adapter.setState(this.CMD_START_STOP, true, true);       
        this.client.setKeepAlive(true, 1000);
        this.adapter.setState('info.service_count', this.serviceCount = 0, true);  
        this.reqCyclicServices(15000, 500);
        this.adapter.log.debug('Ecu.client.on("connect") - connection established');        
      });

      this.client.connect(port, ip, () => {
        this.adapter.log.debug(`Ecu.start(${ip}, ${port}) connecting ...`);
      } );       
    }

    
    //this.adapter.log.silly(`Ecu.start() - done`);
  }


  /*
    Clean and close everything.
   */
  stop() {
    this.adapter.setState('info.connection', false, true);

    if (this.connected) {
      this.client.end(() => {
        this.connected = false;
        this.adapter.setState('info.connection', false, true);      
        this.adapter.setState(this.CMD_START_STOP, false, true);  
        this.client = null;
        this.adapter.log.debug('Ecu.stop() - client.end');   
      });
    }         

    this.adapter.log.debug(`Ecu.stop() - clear cyclicRequestsTimeoutId=${this.cyclicRequestsTimeoutId}`);      
    clearInterval(this.cyclicRequestsTimeoutId);
    this.cyclicRequestsTimeoutId = null;      
    this.adapter.log.debug(`Ecu.stop() - clear writeTimeoutId=${this.writeTimeoutId}`);
    clearTimeout(this.writeTimeoutId);
    this.writeTimeoutId = null;
  
    this.adapter.log.debug(`Ecu.stop() - clear rspWatchDogTimeoutId=${this.rspWatchDogTimeoutId}`);      
    clearInterval(this.rspWatchDogTimeoutId);
    this.rspWatchDogTimeoutId = null;      

    this.ecuId = null;
    this.adapter.log.debug('Ecu.stop() - done');
  }

  /**
   * 
   * @param {*} id 
   * @param {*} state 
   */

  //WMY_CODE = {0: '00', 1: '01', 2:'02', 3: '03'};
  async onStateChange(id, state) {
 
    this.adapter.log.info(`id:${id} state:${state.val}`);

    if (id.includes(this.POWER_OF_DAY_DATE_ID)) {
      if (state.val != this.powerOfDayDate) { 
        this.powerOfDayDate = state.val;
        this.adapter.setState(this.CMD_POWER_OF_DAY_ID, this.cmdPowerOfDay = true, false);
      }
    }
    else if (id.includes(this.CMD_START_STOP)) {
      if ( state.val ) {
        if (!this.connected) {
          this.start(this.adapter.config.ecu_ip, this.adapter.config.ecu_port);
          //this.adapter.setState(this.CMD_START_STOP, true, true);          
          this.adapter.log.info('START execution');          
        }
      }
      else {
        if (this.connected) {
          this.stop();
          //this.adapter.setState(this.CMD_START_STOP, false, true);
          this.adapter.log.info('STOP execution');
        }
      }
    }
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
  

  /*
   * Cyclic service calls
  */
  reqCyclicServices(intervalMsec, serviceDelayMs) {

    // intervalSec min 20sec, default 75sec
    let _intervalMsec = 75 * 1000;
    if ( typeof(intervalMsec) === 'number' && intervalMsec != null ) {
      _intervalMsec = (intervalMsec < 10000) ? 10000 : intervalMsec;
    } 

    // first service calls 
    this.reqDelayedServices(serviceDelayMs);

    // repeated service calls after delay
    this.cyclicRequestsTimeoutId = setInterval( () => {
      this.reqDelayedServices(serviceDelayMs);
    }, _intervalMsec);

    this.adapter.log.debug(`Ecu.reqCyclicServices(intervalMsec=${_intervalMsec}, serviceDelayMs=${serviceDelayMs}) - done`);    
  }

 
  /**
   * 
   * @param {*} delayMs 
   */
  async reqDelayedServices(delayMs) {
    this.adapter.log.debug(`Ecu.reqDelayedServices() ...`);      
    await this.reqDelayedService(delayMs, 'SYSTEMINFO', REQ_SYSTEMINFO + REQ_END + '\r\n');
    
    // give some time to extract ecuId from response of previous service
    if (this.ecuId == null) {
      await this.reqDelayedService(delayMs, 'SYSTEMINFO', REQ_SYSTEMINFO + REQ_END + '\r\n');
    }

    // only for security - ecuId should be available!
    if (this.ecuId != null) {
      await this.reqDelayedService(delayMs, 'REAL_TIME_DATA', REQ_REAL_TIME_DATA + this.ecuId + REQ_END + '\r\n');    
      await this.reqDelayedService(delayMs, 'INVERTER_SIGNAL_LEVEL', REQ_INVERTER_SIGNAL_LEVEL + this.ecuId + REQ_END + '\r\n');    

      if (this.cmdPowerOfDay) {
          let day = this.powerOfDayDate.substring(0,4) + this.powerOfDayDate.substring(5,7) + this.powerOfDayDate.substring(8,10);
          const req = REQ_POWER_OF_DAY + this.ecuId + REQ_END + day + REQ_END + '\r\n';      
          await this.reqDelayedService(delayMs, 'POWER_OF_DAY', req); 
      }
      if (this.cmdEnergyOfWeek) {
        await this.reqDelayedService(delayMs, 'ENERGY_OF_WMY', REQ_ENERGY_OF_WMY + this.ecuId + REQ_END + REQ_WEEK + REQ_END + '\r\n');  // week
      }
      if (this.cmdEnergyOfMonth) {
        await this.reqDelayedService(delayMs, 'ENERGY_OF_WMY', REQ_ENERGY_OF_WMY + this.ecuId + REQ_END + REQ_MONTH + REQ_END + '\r\n');
      }
      if (this.cmdEnergyOfYear) {
        await this.reqDelayedService(delayMs, 'ENERGY_OF_WMY', REQ_ENERGY_OF_WMY + this.ecuId + REQ_END + REQ_YEAR + REQ_END + '\r\n');      
      }
    }               
    this.adapter.log.debug(`Ecu.reqDelayedServices(${delayMs}) - done`);        
  }

/*
  */
reqDelayedService(delayMs, service, req) {
  return new Promise(resolve => {
    if (req != '') {
      this.writeTimoutId = setTimeout( () => {
          if (this.rspWatchDogEnable()) { 
            this.reqStartTime = new Date();
            if (this.client) {
              this.client.write(req);
              this.adapter.log.debug(`Ecu.reqDelayedService(${service} req:${this.hideEcuIdInReq(req)})`);
            }
          }  
          resolve('resolved)');
        }, delayMs);      
    } else {
      this.adapter.log.error(`Ecu.reqDelayedService(req:${req})`);      
    }
  });
}

/**
 * Hide ECU id in service request
 * @param {*} req 
 * @returns modified request (e.c for logging)
 */
hideEcuIdInReq(req) {
  return ((this.hideEcuId && this.ecuId != null) ? 
          req.replace(this.ecuId, '216000xxxxxx') : 
          req);    
}

 /**
  * Enable service response watch dog
  * - unblock waitForResponse 
  * - to be called before sending next service request
  * @returns 
  *   true / false: enabled / response still pending
  *   
  */
  rspWatchDogEnable() {
    let enable = false;
    if (!this.waitForResponse) { 
      this.rspWatchDogTimeoutId = setTimeout( () => {
        this.adapter.log.warn('rspWatchDog - timeout');    
        this.waitForResponse = false;   
      }, 5000);
      enable = this.waitForResponse = true;     
      //this.adapter.log.debug(`rspWatchDogEnable() - ${enable}`);    
    }
    return enable;
  }
  
 /**
  * Disable service response watch dog
  * - to be called if data has been received from socket 
  *
  */
  rspWatchDogDisable() {
    if (this.rspWatchDogTimeoutId != null) {
      clearTimeout(this.rspWatchDogTimeoutId);
      this.rspWatchDogTimeoutId = null;
      //this.adapter.log.debug(`rspWatchDogDisable() - clear`);    
    }
    this.waitForResponse = false;
    //this.adapter.log.debug(`rspWatchDogDisable() - disable`);        
  }


  /*
   */
  decodeRsp(ecuRsp) {
    this.adapter.log.debug('Ecu.decodeRsp:' + bin2HexAscii(this.hideEcuIdInRsp(ecuRsp)));

    let idx = 0;
    let commandNumber = this.decodeHdr(ecuRsp.subarray(idx, (idx += 13)));

    switch (commandNumber) {
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
        this.adapter.log.error('decodeRsp: unknown commandNumber: ' + commandNumber);
        break;
    }
  };

  /**
   * Hide ECU id in service response 
   * @param {*} rsp 
   * @returns modified response (e.c. for logging)
   */
  hideEcuIdInRsp(rsp) {
    let cmd = rsp.subarray(3,5);
  
    return ( (this.hideEcuId && (cmd == [31,31])) ? 
        rsp.subarray(0,13) + [32,31,36,30,30,30, 78, 78, 78, 78, 78, 78] + rsp.subarray(25) :
        rsp);
  }


  /*
   * Decode and process header of any response
   * @param { } [rsp]
   * todo result
   */
  decodeHdr(rsp) {
    let idx = 0;
    let hdr = {};

    hdr.signatureStart = rsp.subarray(idx, (idx += 3)).toString();
    hdr.commandGroup = rsp.subarray(idx, (idx += 2)).toString();
    hdr.frameLen = asciicd2int(rsp.subarray(idx, (idx += 4)));
    hdr.commandNumber = rsp.subarray(idx, (idx += 4)).toString();

    //this.showObj(hdr, 'hdr.', 'hdr.signatureStart'.length);
    return hdr.commandNumber;
  }

  /*
   * Decode and process SystemInfo response 
   * @param { } [rsp]
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

    // todo len
    rtd.matchStatus = rsp.subarray(idx, (idx += 2)).toString(); 
    rtd.ecuModel = rsp.subarray(idx, (idx += 2)).toString();
    rtd.inverters = bin2int(rsp.subarray(idx, (idx += 2)));
    inv.dateTime = bcd2JS_Date(rsp.subarray(idx, (idx += 7)));

    if (rtd.matchStatus = '00') { // semantic not clear
      // todo match status 
      for (let i = 1; i <= rtd.inverters; i++) {
        inv.inverterId = bcd2str(rsp.subarray(idx, (idx += 6)));
        inv.state = bin2int(rsp.subarray(idx, (idx += 1)));
        inv.inverterType = rsp.subarray(idx, (idx += 2)).toString();

        switch (inv.inverterType) {
          case '01': // YC600 TODO not tested
            inv.frequency = bin2int(rsp.subarray(idx, (idx += 2))) / 10.0;
            inv.temperature = bin2int(rsp.subarray(idx, (idx += 2))) - 100.0;
            inv.power1 = bin2int(rsp.subarray(idx, (idx += 2)));
            inv.voltage1 = bin2int(rsp.subarray(idx, (idx += 2)));
            inv.power2 = bin2int(rsp.subarray(idx, (idx += 2)));
            inv.voltage2 = bin2int(rsp.subarray(idx, (idx += 2)));
            break;
          case '02': // YC1000 TODO not tested
            inv.frequency = bin2int(rsp.subarray(idx, (idx += 2))) / 10.0;
            inv.temperature = bin2int(rsp.subarray(idx, (idx += 2))) - 100.0;
            inv.power1 = bin2int(rsp.subarray(idx, (idx += 2)));
            inv.voltage1 = bin2int(rsp.subarray(idx, (idx += 2)));
            inv.power2 = bin2int(rsp.subarray(idx, (idx += 2)));
            inv.voltage2 = bin2int(rsp.subarray(idx, (idx += 2)));
            inv.power3 = bin2int(rsp.subarray(idx, (idx += 2)));
            inv.voltage3 = bin2int(rsp.subarray(idx, (idx += 2)));
          case '03': // QS1
            inv.frequency = bin2int(rsp.subarray(idx, (idx += 2))) / 10.0;
            inv.temperature = bin2int(rsp.subarray(idx, (idx += 2))) - 100.0;
            inv.power1 = bin2int(rsp.subarray(idx, (idx += 2)));
            inv.voltage = bin2int(rsp.subarray(idx, (idx += 2)));
            inv.power2 = bin2int(rsp.subarray(idx, (idx += 2)));
            inv.power3 = bin2int(rsp.subarray(idx, (idx += 2)));
            inv.power4 = bin2int(rsp.subarray(idx, (idx += 2)));
            if (inv.state != 1) {   // clear invalid ecu data
              inv.power1 = inv.power2 = inv.power3 = inv.power4 = 0;
            }
            this.processRealTimeData(inv.inverterId, inv);
            break;
          default:
            // todo 
            break;
        }
      } 
    }
    //this.showObj(rtd, 'rtd.', 'rtd.matchStatus'.length);
    //this.showObj(inv, 'inv.', 'inv.temperature'.length);
  }

  /*
    Process RealTimeData
    * @param { } [inverterId]
    * @param { } [inv]
  */
  processRealTimeData(inverterId, inv) {

    switch (inv.inverterType) {
      case '01': { // YC600 todo  not jet supported
          let yc600Prefix = 'inverters.yc600_' + inverterId;
          this.adapter.log.warn(`Ecu.processRealTimeData() - unsupported inverterType: ${inv.inverterType}`);
        }
        break;
      case '02':  {// YC1000todo  not jet supported
          let yc1000Prefix = 'inverters.yc1000_' + inverterId;
          this.adapter.log.warn(`Ecu.processRealTimeData() - unsupported inverterType: ${inv.inverterType}`);
        }
        break;
      case '03': { // QS1
          let qs1Prefix = 'inverters.qs1_' + inverterId;
          this.createInverterQs1Objects(qs1Prefix);
          this.inverterPrefixTable[inverterId] = qs1Prefix;
          this.adapter.setState(qs1Prefix + '.online', (inv.state == '01'), true); // todo
          this.adapter.setState(qs1Prefix + '.inverter_id', inv.inverterId, true);
          this.adapter.setState(qs1Prefix + '.date_time', inv.dateTime, true);
          this.adapter.setState(qs1Prefix + '.frequency', inv.frequency, true);
          this.adapter.setState(qs1Prefix + '.ac_voltage',parseInt(inv.voltage),true);
          this.adapter.setState(qs1Prefix + '.temperature',inv.temperature,true);
          this.adapter.setState(qs1Prefix + '.dc_power1',parseInt(inv.power1),true);
          this.adapter.setState(qs1Prefix + '.dc_power2',parseInt(inv.power2),true);
          this.adapter.setState(qs1Prefix + '.dc_power3',parseInt(inv.power3),true);
          this.adapter.setState(qs1Prefix + '.dc_power4',parseInt(inv.power4),true);
          this.adapter.setState(qs1Prefix + '.dc_power',inv.power1 + inv.power2 + inv.power3 + inv.power4,true);
        }
        break;
      default:
        this.adapter.log.error(`Ecu.processRealTimeData() - unknown inverterType: ${inv.inverterType}`);
        break;
    }
    this.adapter.setState('info.service_count', ++this.serviceCount, true);  
    this.adapter.log.debug('Ecu.processRealTimeData() - done');
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
  createStaticObjects() {

    this.adapter.setObjectNotExists('ecu', {
      type: 'channel',
      common: {
        name: 'ECU',
      },
      native: {},
    });

    this.adapter.setObjectNotExists(this.CMD_ENERGY_OF_WEEK_ID, {
      type: 'state',
      common: {
        name: 'cmd_energy_of_week',
        role: 'state',
        type: 'boolean',
        read: true,
        write: true,
        def: false,
      },
      native: {},
    });

    this.adapter.setObjectNotExists(this.CMD_START_STOP, {
      type: 'state',
      common: {
        name: 'cmd_start_stop',
        role: 'state',
        type: 'boolean',
        read: true,
        write: true,
        def: true,
      },
      native: {},
    });

    this.adapter.setObjectNotExists(this.CMD_ENERGY_OF_MONTH_ID, {
      type: 'state',
      common: {
        name: 'cmd_energy_of_month',
        role: 'state',
        type: 'boolean',
        read: true,
        write: true,
        def: false,
      },
      native: {},
    });
    
    this.adapter.setObjectNotExists(this.CMD_ENERGY_OF_YEAR_ID, {
      type: 'state',
      common: {
        name: 'cmd_energy_of_year',
        role: 'state',
        type: 'boolean',
        read: true,
        write: true,
        def: false,
      },
      native: {},
    });    

    this.adapter.setObjectNotExists(this.CMD_POWER_OF_DAY_ID, {
      type: 'state',
      common: {
        name: 'cmd_power_of_day',
        role: 'state',  // todo
        type: 'boolean',
        read: true,
        write: true,
        def: false,
      },
      native: {},
    });    
    
    this.adapter.setObjectNotExists(this.POWER_OF_DAY_DATE_ID, { 
      type: 'state',
      common: {
        name: 'power_of_day_date',
        role: 'state', // todo
        type: 'string',
        read: true,
        write: true,
        def: '',
      },
      native: {},
    });    

    this.adapter.setObjectNotExists(this.STATE_SUNRISE, { 
      type: 'state',
      common: {
        name: 'sunrisee',
        role: 'json', 
        type: 'string',
        read: true,
        write: false,
        def: '{}',
      },
      native: {},
    });    

    this.adapter.setObjectNotExists(this.STATE_SUNSET, { 
      type: 'state',
      common: {
        name: 'sunset',
        role: 'json', 
        type: 'string',
        read: true,
        write: false,
        def: '{}',
      },
      native: {},
    });    

    this.adapter.setObjectNotExists('info.id', {
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

    this.adapter.setObjectNotExists('info.version', {
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

    this.adapter.setObjectNotExists('info.timeZone', {
      type: 'state',
      common: {
        name: 'time zone',
        role: 'text',
        type: 'string',
        read: true,
        write: false,
        def: '',
      },
      native: {},
    });

    this.adapter.setObjectNotExists('info.service_count', {
      type: 'state',
      common: {
        name: 'service_counter',
        role: 'value',
        type: 'number',
        read: true,
        write: false,
        def: '0',
      },
      native: {},
    });

    this.adapter.setObjectNotExists('ecu.inverters', {
      type: 'state',
      common: {
        name: 'number of configured inverters',
        role: 'value',
        type: 'number',
        read: true,
        write: false,
        def: '0',
      },
      native: {},
    });

    this.adapter.setObjectNotExists('ecu.inverters_online', {
      type: 'state',
      common: {
        name: 'number of inverters online',
        role: 'value',
        type: 'number',
        read: true,
        write: false,
        def: '0',
      },
      native: {},
    });

    this.adapter.setObjectNotExists('info.model', {
      type: 'state',
      common: {
        name: 'ECU model',
        role: 'text',
        type: 'string',
        read: true,
        write: false,
        def: 'unknown',
      },
      native: {},
    });

    this.adapter.setObjectNotExists('ecu.life_time_energy', {
      type: 'state',
      common: {
        name: 'ECU life time energy',
        role: 'value.power',        
        type: 'number',
        unit: 'kWh',
        read: true,
        write: false,
        def: 0,
      },
      native: {},
    });

    this.adapter.setObjectNotExists('ecu.last_system_power', {
      type: 'state',
      common: {
        name: 'last ECU power value',
        role: 'value.power',
        type: 'number',
        unit: 'W',
        read: true,
        write: false,
        def: 0,
      },
      native: {},
    });

    this.adapter.setObjectNotExists('ecu.current_day_energy', {
      type: 'state',
      common: {
        name: 'ECU energy of the day',
        role: 'value.power',
        type: 'number',
        unit: 'kWh',
        read: true,
        write: true,
        def: 0,
      },
      native: {},
    });

    this.adapter.setObjectNotExists('ecu.power_of_day_list', {
      type: 'state',
      common: {
        name: 'list of ECU power values today',
        role: 'json',      
        def: '{}',
        unit: 'W',
        type: 'string', 
        read: true,
        write: true,
        desc: 'power of day list',
      },
      native: {},
    });

    this.adapter.setObjectNotExists('ecu.energy_of_week_list', {
      type: 'state',
      common: {
        name: 'list of ECU energy values for last seven days (week)',
        role: 'json',        
        def: '{}',
        unit: 'kWh',
        type: 'string',
        read: true,
        write: true,
        desc: 'power of week list',
      },
      native: {},
    });

    this.adapter.setObjectNotExists('ecu.energy_of_month_list', {
      type: 'state',
      common: {
        name: 'list of ECU energy values of last 30 days',
        role: 'json',        
        def: '{}',
        unit: 'kWh',
        type: 'string',
        read: true,
        write: true,
        desc: 'power of month list',
      },
      native: {},
    });

    this.adapter.setObjectNotExists('ecu.energy_of_year_list', {
      type: 'state',
      common: {
        name: 'list of ECU monthly energy values for twelve months)',
        role: 'json',        
        def: '{}',
        unit: 'kWh',
        type: 'string',
        read: true,
        write: false,
        desc: 'power of year list',
      },
      native: {},
    });

    this.adapter.setObjectNotExists('inverters', {
      type: 'folder',
      common: {
        name: 'inverters',
        desc: 'organization of connected inverters',
      },
      native: {},
    });
/*
    // init power_of_day_date
    if (this.adapter.getState('ecu.power_of_day_date').val == '') {
      let todayISO = new Date().toISOString();
      day = todayISO.substring(0,4) + todayISO.substring(5,7) + todayISO.substring(8,10);     
      this.adapter.setState('ecu.power_of_day_date', day); 
    } */
  }

  

  /*
   * Create all inverter specific objects if needed
   * <adapter>/inverters/<inverter>/<states>
   */
  async createInverterQs1Objects(prefix) {
    await this.adapter.getState(prefix + '.online', (err, obj) => {
      if (!obj) {
        this.adapter.log.debug(`ecu.createInverterQs1Objects(${prefix}) ...` );

        this.adapter.setObjectNotExists(prefix, {
          type: 'channel',
          common: {
            name: prefix,
          },
          native: {},
        });

        this.adapter.setObjectNotExists(
          prefix + '.online',
          {
            type: 'state',
            common: {
              name: 'inverter is online',
              role: 'indicator.connected',
              def: false,
              type: 'boolean',
              read: true,
              write: false,
              desc: 'inverter is working',
            },
            native: {},
          }
        );

        this.adapter.setObjectNotExists(
          prefix + '.date_time', 
          {
            type: 'state',
            common: {
              name: 'timestamp time of realtime data',
              role: 'value.time',
              def: 'unknown',
              type: 'string',
              read: true,
              write: false,
              desc: 'timestamp of real time data',
            },
            native: {},
          }
        );

        this.adapter.setObjectNotExists(
          prefix + '.signal_level', 
          {
            type: 'state',
            common: {
              name: 'inverter zigbee signal strength',
              role: 'value',
              def: 0,
              type: 'number',
              read: true,
              write: false,
              desc: 'zigbee signal strength',
            },
            native: {},
          }
        );    

        this.adapter.setObjectNotExists(
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
              desc: 'serial number',
            },
            native: {},
          }
        );

        this.adapter.setObjectNotExists(
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
              desc: 'ac frequency',
            },
            native: {},
          }
        );

        this.adapter.setObjectNotExists(
          prefix + '.temperature',
          {
            type: 'state',
            common: {
              name: 'inverter temperature',
              role: 'value.temperature',
              def: 0,
              unit: '°C',
              type: 'number',
              read: true,
              write: false,
              desc: 'inverter temperature',
            },
            native: {},
          }
        );

        this.adapter.setObjectNotExists(
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
              desc: 'ac voltage',
            },
            native: {},
          }
        );

        this.adapter.setObjectNotExists(
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
              desc: 'total dc power',
            },
            native: {},
          }
        );

        this.adapter.setObjectNotExists(
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
              desc: 'dc power module 1',
            },
            native: {},
          }
        );

        this.adapter.setObjectNotExists(
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
              desc: 'dc power module 2',
            },
            native: {},
          }
        );

        this.adapter.setObjectNotExists(
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
              desc: 'dc power module 3',
            },
            native: {},
          }
        );

        this.adapter.setObjectNotExists(
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
              desc: 'dc power module 4',
            },
            native: {},
          }
        ); 
      } // if (err)
    });
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

function bcd2JS_Date(buf) {
  let str = bcd2str(buf);
  let dateTimeStr = str.substring( 0,  4) + '-' + // year
                    str.substring( 4,  6) + '-' + // month
                    str.substring( 6,  8) + 'T' + // day
                    str.substring( 8, 10) + ':' + // hour
                    str.substring(10, 12) + ':' + // minute                                                            
                    str.substring(12, 14);        // second
  return (new Date(dateTimeStr)).toDateString();                    
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

module.exports = { Ecu };
