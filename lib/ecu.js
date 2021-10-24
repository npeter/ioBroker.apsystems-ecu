"use strict";
const { getAbsoluteInstanceDataDir } = require("@iobroker/adapter-core");
const Net = require("net");

const REQ_SYSTEMINFO = "APS1100160001";
const REQ_REAL_TIME_DATA = "APS1100280002";
const REQ_POWER_OF_DAY = "APS1100390003";
const REQ_INVERTER_SIGNAL_LEVEL = "APS1100280030";
const REQ_ENERGY_OF_WMY = "APS1100390004";
const REQ_END = "END";
const REQ_WEEK = '00';
const REQ_MONTH = '01';
const REQ_YEAR = '02';


/*
*/
class Ecu {

  /** 
   * @param {todo} adapter

   */
  constructor(adapter) {
    this.adapter = adapter;
    this.ecuId = null;
    //this.realTimeDataTimeoutId = null;
    //this.timeoutPowerOfDay = null;
    this.cyclicRequestsTimeoutId = null;
    this.rspWatchDogTimeoutId = null;
    this.client = null;
    this.inverterPrefix = {};
    this.waitForResponse = false;
    this.connected = false;
    this.reqService = 'systemInfo';    
    this.reqStartTime = 0;
    this.serviceTime = 0;

    this.reqSystemInfoStr = REQ_SYSTEMINFO + REQ_END + "\r\n";;
    this.reqRealTimeDataStr = '';
    this.reqInverterSignalLevelStr = '';
    

    this.createEcuObjects();
  }

  /*
   * Establish ECU connection
   * Install event handlers
   * request systemInfo from ECU
   */
  async start(ip, port) {
    // check ip and port todo
    this.ecuId = null;
    this.reqRealTimeDataStr = '';
    this.reqInverterSignalLevelStr = '';    
    this.client = new Net.Socket();

    this.client.on('error', (error) => {
      this.adapter.log.error('Ecu.client.on("error") - socket error: ' + error);
      this.end(); 
    });

    this.client.on('timeout', () => {
      this.adapter.log.error('Ecu.client.on("timeout") - socket timeout');
      this.end();
    });

    this.client.on("data", (ecuRsp) => {
      let serviceTime = Date.now() - this.reqStartTime;
      this.rspWatchDogDisable();       
      this.adapter.log.debug(`Ecu.client.on("data") - serviceTime=${serviceTime}`);
      this.decodeRsp(ecuRsp); 
     });

    this.client.connect(port, ip, () => {
      this.connected = true;
      this.client.setKeepAlive(true, 1000);
      this.adapter.setState('info.connection', true, true);    
      this.reqCyclicServices(10000, 500);
      this.adapter.log.debug('Ecu.client.connect(${ip}, ${port}) - done');
    } );   
    
    this.adapter.log.silly(`Ecu.start() - done`);
  }


  /*
    Clean and close everything.
   */
  end() {
    this.adapter.setState('info.connection', false, true);

    /*
    if (this.realTimeDataTimeoutId) {
      clearInterval(this.realTimeDataTimeoutId);
      this.realTimeDataTimeoutId = null;
    }
    */
    /*
    if (this.powerOfDayTimeoutId) {
      clearInterval(this.powerOfDayTimeoutId);
      this.powerOfDayTimeoutId = null;
    }
    */
    if (this.cyclicRequestsTimeoutId) {
      clearInterval(this.cyclicRequestsTimeoutId);
      this.cyclicRequestsTimeoutId = null;
    }

    if (this.rspWatchDogTimeoutId) {
      clearInterval(this.rspWatchDogTimeoutId);
      this.rspWatchDogTimeoutId = null;
    }    

    if (this.connected) {
      this.client.end(() => {
        this.client = null;
      });
    }      
    this.adapter.log.debug("Ecu.end() - done");
  }

  /*
  */
  reqCyclicServices(intervalMsec, serviceDelayMs) {

    // intervalSec min 20sec, default 75sec
    let _intervalMsec = 75 * 1000;
    if ( typeof(intervalMsec) === 'number' && intervalMsec != null ) {
      _intervalMsec = (intervalMsec < 10000) ? 10000 : intervalMsec;
    } 

    this.reqDelayedServices(serviceDelayMs, 'all');

    this.cyclicRequestsTimeoutId = setInterval( () => {
 
      this.reqDelayedServices(serviceDelayMs, 'realtime');
    }, _intervalMsec);
    this.adapter.log.debug(`Ecu.reqCyclicServices(intervalMsec=${_intervalMsec}, serviceDelayMs=${serviceDelayMs}) - done`);    
  }





   /*
 */
   async reqDelayedServices(delayMs, select) {
    this.adapter.log.debug(`Ecu.reqDelayedServices() ...`);      
    await this.reqDelayedService(delayMs, this.reqSystemInfoStr);
    if (this.ecuId != '') {
      await this.reqDelayedService(delayMs, REQ_REAL_TIME_DATA + this.ecuId + REQ_END + "\r\n");    
      await this.reqDelayedService(delayMs, REQ_INVERTER_SIGNAL_LEVEL + this.ecuId + REQ_END + "\r\n");    

      if (select === 'all') {
        {
          let todayISO = new Date().toISOString();
          let day = todayISO.substring(0,4) + todayISO.substring(5,7) + todayISO.substring(8,10);
          const req = REQ_POWER_OF_DAY + this.ecuId + REQ_END + day + REQ_END + "\r\n";      
          await this.reqDelayedService(delayMs, req); 
        }

        await this.reqDelayedService(delayMs, REQ_ENERGY_OF_WMY + this.ecuId + REQ_END + REQ_WEEK + REQ_END + "\r\n");  // week
        await this.reqDelayedService(delayMs, REQ_ENERGY_OF_WMY + this.ecuId + REQ_END + REQ_MONTH + REQ_END + "\r\n");
        await this.reqDelayedService(delayMs, REQ_ENERGY_OF_WMY + this.ecuId + REQ_END + REQ_YEAR + REQ_END + "\r\n");      
      }
    }
               
    this.adapter.log.debug(`Ecu.reqDelayedServices(${delayMs}, ${select}) - done`);        
  }

/*
  */
reqDelayedService(delayMs, req) {
  return new Promise(resolve => {
    if (req != '') {
      setTimeout( () => {
          if (this.rspWatchDogEnable()) { 
            this.reqStartTime = new Date();
            this.client.write(req);
            this.adapter.log.debug(`Ecu.reqDelayedService(req:${req})`);
          }  
          resolve('resolved)');
        }, delayMs);      
    } else {
      this.adapter.log.error(`Ecu.reqDelayedService(req:${req})`);      
    }
  });
}

  /*
  */
  reqDelayedPowerOfDay(delayMs, day) {    // todo
    return new Promise(resolve => {
      setTimeout( () => {
        this.reqPowerOfDay(day);
        resolve('resolved');      
      }, delayMs);
    });
  }

  /*
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
  
  /*
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
    Request PowerOfDay service
    - request inverter data
    - skipped if response for previous request missed
    - todo parameter
   */
  reqPowerOfDay(day) {    // TODO
    //let day = this.adapter.getState('ecu.power_of_day_date').val;
    
    if ( day == null) {
      let todayISO = new Date().toISOString();
      day = todayISO.substring(0,4) + todayISO.substring(5,7) + todayISO.substring(8,10);
    }
    
    if (this.ecuId != null) { 
      if (this.rspWatchDogEnable()) { 
        // todo parameter pruefen -> heute
        if (this.ecuId != null) {
          const req = REQ_POWER_OF_DAY + this.ecuId + REQ_END + day + REQ_END + "\r\n";      
          this.reqStartTime = Date.now();
          this.client.write(req);
          this.adapter.log.debug("reqPowerOfDay: " + req);
        }
      } else {
        this.adapter.log.error("reqPowerOfDay() invalid ecuId: " + this.ecuId);
      } 
    }
  }

  /*
   */
  decodeRsp = (ecuRsp) => {
    this.adapter.log.debug("Ecu.decodeRsp:" + bin2HexAscii(ecuRsp));

    let idx = 0;
    let commandNumber = this.decodeHdr(ecuRsp.subarray(idx, (idx += 13)));

    switch (commandNumber) {
      case "0001": // systeminfo
        this.decodeAndProcessSystemInfo(ecuRsp.subarray(idx));
        break;
      case "0002": // realTimeData
        this.decodeAndProcessRealTimeData(ecuRsp.subarray(idx));
        break;
      case "0003": // power of day
        this.decodeAndProcessPowerOfDay(ecuRsp.subarray(idx));
        break;
      case "0004": // energy of month / week / year
        this.decodeAndProcessEnergyOfWMY(ecuRsp.subarray(idx));
        break;
      case "0030": // inverterSignalLevel
        this.decodeAndProcessInverterSignalLevel(ecuRsp.subarray(idx, idx + 999));
        break;
      default:
        this.adapter.log.error(
          "decodeRsp: unknown commandNumber: " + commandNumber
        );
        break;
    }
  };

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

    //this.showObj(hdr, "hdr.", "hdr.signatureStart".length);
    return hdr.commandNumber;
  }

  /*
   * Decode and process SystemInfo response 
   * @param { } [rsp]
   */
  decodeAndProcessSystemInfo(rsp) {
    let idx = 0;
    let sys = {};

    sys.id = this.ecuId = rsp.subarray(idx, (idx += 12)).toString();
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

    //this.showObj(sys, "hdr.", "sys.lastTimeConnectedEMA".length);

    this.adapter.setState("ecu.id", sys.id, true);
    this.adapter.setState("ecu.model", sys.model, true);
    this.adapter.setState("ecu.life_time_energy", sys.lifeTimeEnergy, true);
    this.adapter.setState("ecu.last_system_power", sys.lastSystemPower, true);
    this.adapter.setState("ecu.current_day_energy", sys.currentDayEnergy, true);
    this.adapter.setState("ecu.version", sys.version, true);
    this.adapter.setState("ecu.timeZone", sys.timeZone, true);
    this.adapter.setState("ecu.inverters", sys.inverters, true);
    this.adapter.setState("ecu.inverters_online", sys.invertersOnline, true);

    this.adapter.log.debug("Ecu.decodeAndProcessSystemInfo() - done");
  }

  /*
   * Decode and process RealTimeData response 
   * @param { } [res]
   */
  decodeAndProcessRealTimeData(rsp) {
    let idx = 0;
    let rtd = {};
    let inv = {};

    rtd.matchStatus = rsp.subarray(idx, (idx += 2)).toString();
    rtd.ecuModel = rsp.subarray(idx, (idx += 2)).toString();
    rtd.inverters = bin2int(rsp.subarray(idx, (idx += 2)));
    inv.dateTime = bcd2datetime(rsp.subarray(idx, (idx += 7)));

    // todo match status 
    for (let i = 1; i <= rtd.inverters; i++) {
      inv.inverterId = bcd2str(rsp.subarray(idx, (idx += 6)));
      inv.state = bin2int(rsp.subarray(idx, (idx += 1)));
      inv.inverterType = rsp.subarray(idx, (idx += 2)).toString();

      switch (inv.inverterType) {
        case "01": // YC600 TODO not tested
          inv.frequency = bin2int(rsp.subarray(idx, (idx += 2))) / 10.0;
          inv.temperature = bin2int(rsp.subarray(idx, (idx += 2))) - 100.0;
          inv.power1 = bin2int(rsp.subarray(idx, (idx += 2)));
          inv.voltage1 = bin2int(rsp.subarray(idx, (idx += 2)));
          inv.power2 = bin2int(rsp.subarray(idx, (idx += 2)));
          inv.voltage2 = bin2int(rsp.subarray(idx, (idx += 2)));
          break;
        case "02": // YC1000 TODO not tested
          inv.frequency = bin2int(rsp.subarray(idx, (idx += 2))) / 10.0;
          inv.temperature = bin2int(rsp.subarray(idx, (idx += 2))) - 100.0;
          inv.power1 = bin2int(rsp.subarray(idx, (idx += 2)));
          inv.voltage1 = bin2int(rsp.subarray(idx, (idx += 2)));
          inv.power2 = bin2int(rsp.subarray(idx, (idx += 2)));
          inv.voltage2 = bin2int(rsp.subarray(idx, (idx += 2)));
          inv.power3 = bin2int(rsp.subarray(idx, (idx += 2)));
          inv.voltage3 = bin2int(rsp.subarray(idx, (idx += 2)));
        case "03": // QS1
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

    //this.showObj(rtd, "rtd.", "rtd.matchStatus".length);
    //this.showObj(inv, "inv.", "inv.temperature".length);
  }

  /*
    Process RealTimeData
    * @param { } [inverterId]
    * @param { } [inv]
  */
  processRealTimeData(inverterId, inv) {

    switch (inv.inverterType) {
      case "01": { // YC600 todo  not jet supported
          let yc600Prefix = "inverters.yc600_" + inverterId;
          this.adapter.log.warn(`Ecu.processRealTimeData() - unsupported inverterType: ${inv.inverterType}`);
        }
        break;
      case "02":  {// YC1000todo  not jet supported
          let yc1000Prefix = "inverters.yc1000_" + inverterId;
          this.adapter.log.warn(`Ecu.processRealTimeData() - unsupported inverterType: ${inv.inverterType}`);
        }
        break;
      case "03": { // QS1
          let qs1Prefix = "inverters.qs1_" + inverterId;
          this.createInverterQs1Objects(qs1Prefix);
          this.inverterPrefix[inverterId] = qs1Prefix;
          this.adapter.setState(qs1Prefix + ".online", (inv.state == "01"), true); // todo
          this.adapter.setState(qs1Prefix + ".inverter_id", inv.inverterId, true);
          this.adapter.setState(qs1Prefix + ".date_time", inv.dateTime, true);
          this.adapter.setState(qs1Prefix + ".frequency", inv.frequency, true);
          this.adapter.setState(qs1Prefix + ".ac_voltage",parseInt(inv.voltage),true);
          this.adapter.setState(qs1Prefix + ".temperature",inv.temperature,true);
          this.adapter.setState(qs1Prefix + ".dc_power1",parseInt(inv.power1),true);
          this.adapter.setState(qs1Prefix + ".dc_power2",parseInt(inv.power2),true);
          this.adapter.setState(qs1Prefix + ".dc_power3",parseInt(inv.power3),true);
          this.adapter.setState(qs1Prefix + ".dc_power4",parseInt(inv.power4),true);
          this.adapter.setState(qs1Prefix + ".dc_power",inv.power1 + inv.power2 + inv.power3 + inv.power4,true);
        }
        break;
      default:
        this.adapter.log.error(`Ecu.processRealTimeData() - unknown inverterType: ${inv.inverterType}`);
        break;
    }
    this.adapter.log.debug("Ecu.processRealTimeData() - done");
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

    if (pod.status == "00") {
      for (let len = rsp.subarray(idx).length - 2 - 4; len > 0; len -= 4) {
        pow[bcd2time(rsp.subarray(idx, (idx += 2)))] = 
          bin2int(rsp.subarray(idx, (idx += 2))
        );
      }
      this.adapter.setState("ecu.power_of_day_list", JSON.stringify(pow), true);    
    }

    //this.showObj(pod, "pod.", "pod.status".length);
    this.adapter.log.debug(`Ecu.decodeAndProcessPowerOfDay() - status=${pod.status} - done`);
  }

  /*
   * Decode and process decodeAndProcessEnergyOfWMY response
   * @param {} [rsp]
   */
  decodeAndProcessEnergyOfWMY(rsp) {
    var idx = 0;
    let energy = {};
    let ewmy = {};

    energy.status = rsp.subarray(idx, (idx += 2)).toString();
    energy.wmy = rsp.subarray(idx, (idx += 2)).toString();

    if (energy.status == "00") {
      for (let len = rsp.subarray(idx).length - 4; len > 0; len -= 6) {
        ewmy[bcd2datetime(rsp.subarray(idx, (idx += 4)))] = bin2int(rsp.subarray(idx, (idx += 2))) / 100;
      }
      switch (energy.wmy) {
        case "00":
          this.adapter.setState("ecu.energy_of_week_list", JSON.stringify(ewmy), true);
          break;
        case "01":
          this.adapter.setState("ecu.energy_of_month_list", JSON.stringify(ewmy), true);
          break;
        case "02":
          this.adapter.setState("ecu.energy_of_year_list", JSON.stringify(ewmy), true);
          break;
        default:
          this.adapter.log.error("Ecu.energy_of_year_list (" + energy.wmy + ") - bad");
          break;
      }    
    }

    //this.showObj(energy, "energy.", "energy.wmy".length);
    //this.showObj(ewmy);

    this.adapter.log.debug(`Ecu.decodeAndProcessEnergyOfWMY() - wmy=${energy.wmy} - done`);
  }

  /*
   * Decode and process InvertersSignalLevel response
   */
  decodeAndProcessInverterSignalLevel(rsp) {
    var idx = 0;
    let isl = {};

    isl.status = rsp.subarray(idx, (idx += 2)).toString();

    if (isl.status == "00") {

      for (let len = rsp.subarray(idx).length - 2 - 7; len > 0; len -= 7) {
        isl.inverterId = bcd2str(rsp.subarray(idx, (idx += 6)));
        isl.level = bin2int(rsp.subarray(idx, (idx += 1)));
  
        let prefix = this.inverterPrefix[isl.inverterId];
        if (prefix) {
          this.adapter.setState(prefix + ".signal_level", isl.level, true);  
        }    
      }
    }

    //this.showObj(isl, "isl.", "isl.inverterId".length);
    this.adapter.log.debug(`Ecu.decodeAndProcessInverterSignalLevel() - status=${isl.status} - done`);
  }

  /*
   * Create all static objects
   * <adapter>/ecu/<states>
   * <adapter>/inverters
   */
  createEcuObjects() {

    // todo optimize
    this.adapter.setObjectNotExists("ecu", {
      type: "folder",
      common: {
        name: "ECU",
      },
      native: {},
    });

    this.adapter.setObjectNotExists("ecu.id", {
      type: "state",
      common: {
        role: "info.name",
        name: "ECU serial number",
        type: "string",
        read: true,
        write: false,
        def: "",
      },
      native: {},
    });

    this.adapter.setObjectNotExists("ecu.version", {
      type: "state",
      common: {
        role: "info.name",
        name: "ECU firmware version",
        type: "string",
        read: true,
        write: false,
        def: "",
      },
      native: {},
    });

    this.adapter.setObjectNotExists("ecu.timeZone", {
      type: "state",
      common: {
        role: "info.name",
        name: "time zone",
        type: "string",
        read: true,
        write: false,
        def: "",
      },
      native: {},
    });

    this.adapter.setObjectNotExists("ecu.inverters", {
      type: "state",
      common: {
        role: "info.name",
        name: "number of configured inverters",
        type: "number",
        read: true,
        write: false,
        def: "0",
      },
      native: {},
    });

    this.adapter.setObjectNotExists("ecu.inverters_online", {
      type: "state",
      common: {
        role: "info.name",
        name: "number of inverters online",
        type: "number",
        read: true,
        write: false,
        def: "0",
      },
      native: {},
    });

    this.adapter.setObjectNotExists("ecu.model", {
      type: "state",
      common: {
        //"role": "info.name",
        name: "ECU model",
        type: "string",
        read: true,
        write: false,
        def: "unknown",
      },
      native: {},
    });

    this.adapter.setObjectNotExists("ecu.life_time_energy", {
      type: "state",
      common: {
        //"role": "info.name",
        name: "ECU life time energy",
        type: "number",
        unit: "kWh",
        read: true,
        write: false,
        def: 0,
      },
      native: {},
    });

    this.adapter.setObjectNotExists("ecu.last_system_power", {
      type: "state",
      common: {
        //"role": "info.name",
        name: "last ECU power value",
        type: "number",
        unit: "W",
        read: true,
        write: false,
        def: 0,
      },
      native: {},
    });

    this.adapter.setObjectNotExists("ecu.current_day_energy", {
      type: "state",
      common: {
        //"role": "info.name",
        name: "ECU energy of the day",
        type: "number",
        unit: "kWh",
        read: true,
        write: false,
        def: 0,
      },
      native: {},
    });

    this.adapter.setObjectNotExists("ecu.power_of_day_date", {
      type: "state",
      common: {
        name: "date used by power_of_day_list",
        def: "20211023",
        unit: "",
        type: "string",
        read: true,
        write: true,
        desc: "date used by power_of_day_list *yyyy.mm.dd",
      },
      native: {},
    });

    this.adapter.setObjectNotExists("ecu.power_of_day_list", {
      type: "state",
      common: {
        name: "list of ECU power values today",
        def: "",
        unit: "",
        type: "string",
        read: true,
        write: false,
        desc: "power of day list",
      },
      native: {},
    });

    this.adapter.setObjectNotExists("ecu.energy_of_week_list", {
      type: "state",
      common: {
        name: "list of ECU energy values for last seven days (week)",
        def: "",
        unit: "",
        type: "string",
        read: true,
        write: false,
        desc: "power of week list",
      },
      native: {},
    });

    this.adapter.setObjectNotExists("ecu.energy_of_month_list", {
      type: "state",
      common: {
        name: "list of ECU energy values of last 30 days",
        def: "",
        unit: "",
        type: "string",
        read: true,
        write: false,
        desc: "power of month list",
      },
      native: {},
    });

    this.adapter.setObjectNotExists("ecu.energy_of_year_list", {
      type: "state",
      common: {
        name: "list of ECU monthly energy values for twelve months)",
        def: "",
        unit: "",
        type: "string",
        read: true,
        write: false,
        desc: "power of year list",
      },
      native: {},
    });

    this.adapter.setObjectNotExists("inverters", {
      type: "folder",
      common: {
        name: "inverters",
        desc: "organization of connected inverters",
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
   * Create all inverter specific objects
   * <adapter>/inverters/<inverter>/<states>
   */
  createInverterQs1Objects(prefix) {
    // todo optimize
    this.adapter.setObjectNotExists(prefix, {
      type: "channel",
      common: {
        name: prefix,
      },
      native: {},
    });

    this.adapter.setObjectNotExists(
      prefix + ".online",
      {
        type: "state",
        common: {
          name: "inverter is online",
          def: false,
          type: "boolean",
          read: true,
          write: false,
          desc: "inverter is working",
        },
        native: {},
      }
    );

    this.adapter.setObjectNotExists(
      prefix + ".date_time", 
      {
        type: "state",
        common: {
          name: "timestamp time of realtime data",
          def: "unknown",
          type: "string",
          read: true,
          write: false,
          desc: "timestamp of real time data",
        },
        native: {},
      }
    );

    this.adapter.setObjectNotExists(
      prefix + ".signal_level", 
      {
        type: "state",
        common: {
          name: "inverter zigbee signal strength",
          def: 0,
          type: "number",
          read: true,
          write: false,
          desc: "zigbee signal strength",
        },
        native: {},
      }
    );    

    this.adapter.setObjectNotExists(
      prefix + ".inverter_id",
      {
        type: "state",
        common: {
          name: "inverter serial number",
          def: "unknown",
          type: "string",
          read: true,
          write: false,
          desc: "serial number",
        },
        native: {},
      }
    );

    this.adapter.setObjectNotExists(
      prefix + ".frequency",
      {
        type: "state",
        common: {
          name: "ac frequency",
          def: 0,
          unit: "Hz",
          type: "number",
          read: true,
          write: false,
          desc: "ac frequency",
        },
        native: {},
      }
    );

    this.adapter.setObjectNotExists(
      prefix + ".temperature",
      {
        type: "state",
        common: {
          name: "inverter temperature",
          def: 0,
          unit: "°C",
          type: "number",
          read: true,
          write: false,
          desc: "inverter temperature",
        },
        native: {},
      }
    );

    this.adapter.setObjectNotExists(
      prefix + ".ac_voltage",
      {
        type: "state",
        common: {
          name: "ac voltage",
          def: 0,
          unit: "V",
          type: "number",
          read: true,
          write: false,
          desc: "ac voltage",
        },
        native: {},
      }
    );

    this.adapter.setObjectNotExists(
      prefix + ".dc_power",
      {
        type: "state",
        common: {
          name: "total dc power",
          def: 0,
          unit: "W",
          type: "number",
          read: true,
          write: false,
          desc: "total dc power",
        },
        native: {},
      }
    );

    this.adapter.setObjectNotExists(
      prefix + ".dc_power1",
      {
        type: "state",
        common: {
          name: "dc power module 1",
          def: 0,
          unit: "W",
          type: "number",
          read: true,
          write: false,
          desc: "dc power module 1",
        },
        native: {},
      }
    );

    this.adapter.setObjectNotExists(
      prefix + ".dc_power2",
      {
        type: "state",
        common: {
          name: "dc power module 2",
          def: 0,
          unit: "W",
          type: "number",
          read: true,
          write: false,
          desc: "dc power module 2",
        },
        native: {},
      }
    );

    this.adapter.setObjectNotExists(
      prefix + ".dc_power3",
      {
        type: "state",
        common: {
          name: "dc power module 3",
          def: 0,
          unit: "W",
          type: "number",
          read: true,
          write: false,
          desc: "dc power module 3",
        },
        native: {},
      }
    );

    this.adapter.setObjectNotExists(
      prefix + ".dc_power4",
      {
        type: "state",
        common: {
          name: "dc power module 4",
          def: 0,
          unit: "W",
          type: "number",
          read: true,
          write: false,
          desc: "dc power module 4",
        },
        native: {},
      }
    );
  
} 

/*
 */
showObj(obj, prefix, len) {
  console.log(obj.toString());
  for (const [key, value] of Object.entries(obj)) {
    const str =
      (
        prefix +
        key +
        "                                               "
      ).substr(0, len) +
      ": " +
      value;
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
  let byte = "";
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
  let bcdStr = "";
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
  let datetimeStr =
    str.substring(0, 4) +
    "." + // year
    str.substring(4, 6) +
    "." + // month
    str.substring(6, 8); // day
  if (str.length > 8) {
    datetimeStr +=
      "-" +
      str.substring(8, 10) +
      ":" + // hour
      str.substring(10, 12) +
      ":" + // minute
      str.substring(12, 14); // second
  }
  return datetimeStr;
}

/*
 */
function bcd2time(buf) {
  let str = bcd2str(buf);
  let timeStr =
    str.substring(0, 2) +
    ":" + // hh
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