"use strict";
const Net = require("net");

const REQ_SYSTEMINFO = "APS1100160001";
const REQ_REAL_TIME_DATA = "APS1100280002";
const REQ_POWER_OF_DAY = "APS1100390003";
const REQ_INVERTER_SIGNAL_LEVEL = "APS1100280030";
const REQ_ENERGY_OF_WMY = "APS1100390004";
const REQ_END = "END";


/*
*/
class Ecu {

  /** 
   * @param {todo} adapter

   */
  constructor(adapter) {
    this.adapter = adapter;
    this.ecuId = null;
    this.timeoutRealTimeData = null;
    this.timeoutPowerOfDay = null;
    this.timeoutCyclicRequests = null;
    this.client = null;
    this.inverterPrefix = {};
    this.waitForResponse = false;
    this.connected = false;
    this.reqService = 'systemInfo';    

    this.createEcuObjects();
  }

  /*
   * Establish ECU connection
   * Install event handlers
   * request systemInfo from ECU
   */
  async start(ip, port) {
    // check ip and port
    this.ecuId = null;
    this.client = new Net.Socket();

    this.client.on('connect', (socket) => {
      this.connected = true;
      this.adapter.setState('info.connection', true, true);    
      this.reqCyclicServices(11);
      this.adapter.log.debug('Ecu.start() - socket connect');
    })
      
    this.client.on('error', (error) => {
      this.adapter.log.error('Ecu.start() - socket error: ' + error);
      this.end(); 
    });
    this.client.on('timeout', () => {
      this.adapter.log.error('Ecu.start() - socket timeout');
      this.end();
    });
    this.client.on("data", (ecuRsp) => {
      this.decodeRsp(ecuRsp); 
    });
    this.client.connect({ port: port, host: ip });    
    
    this.adapter.log.debug(`Ecu.start(${ip}, ${port}) - done`);
  }


  /*
    Clean and close everything.
   */
  end() {
    this.adapter.setState('info.connection', false, true);

    if (this.timeoutRealTimeData) {
      clearInterval(this.timeoutRealTimeData);
      this.timeoutRealTimeData = null;
    }

    if (this.timeoutPowerOfDay) {
      clearInterval(this.timeoutPowerOfDay);
      this.timeoutPowerOfDay = null;
    }

    if (this.timeoutCyclicRequests) {
      clearInterval(this.timeoutCyclicRequests);
      this.timeoutCyclicRequests = null;
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
  tstAlllReq() {
    setTimeout(() => {
      this.reqSystemInfo();
      setTimeout(() => {
        this.reqRealTimeData();
        setTimeout(() => {
          this.reqPowerOfDay();
          setTimeout(() => {
            this.reqEnergyOfWMY("week");
            setTimeout(() => {
              this.reqEnergyOfWMY("month");
              setTimeout(() => {
                this.reqEnergyOfWMY("year");
                setTimeout(() => {
                  this.reqInverterSignalLevel();
                  setTimeout(() => {
                    this.cyclicRequests(20);
                  })
                }, 3000);
              }, 3000);
            }, 3000);
          }, 3000);
        }, 3000);
      }, 3000);
    }, 3000);
  }

  
  reqDelayedRealTimeData(seconds) {
    return new Promise(resolve => {
     setTimeout( () => {
        this.reqRealTimeData();
        resolve('resolved)');
      }, seconds * 1000);
    })
  }

  reqDelayedSystemInfo(seconds) {
    return new Promise(resolve => {
      setTimeout( () => {
        this.reqSystemInfo();
        resolve('resolved)');
      }, seconds * 1000);
    })
  }

  reqDelayedSignalLevel(seconds) {
    return new Promise(resolve => {
      setTimeout( () => {
        this.reqInverterSignalLevel();
        resolve('resolved');      
      }, seconds * 1000);
    });
  }

  reqDelayedPowerOfDay(seconds,day) {
    return new Promise(resolve => {
      setTimeout( () => {
        this.reqPowerOfDay(day);
        resolve('resolved');      
      }, seconds * 1000);
    });
  }

  reqDelayedEnergyOfWMY(seconds, wmy) {
    return new Promise(resolve => {
      setTimeout( () => {
        this.reqEnergyOfWMY(wmy);
        resolve('resolved');      
      }, seconds * 1000);
    });
  }




  async reqDelayedServices(delay, all) {
    this.adapter.log.debug(`ecu.reqDelayedServices() ...`);      
    const resultReqDelayedSystemInfo = await this.reqDelayedSystemInfo(delay);
    const resultReqDelayedRealTimeData = await this.reqDelayedRealTimeData(delay);
    const resultReqDelayedSignalLevel = await this.reqDelayedSignalLevel(delay);
    if (all) {
      const resultReqPowerOfDay = await this.reqDelayedPowerOfDay(delay);
      const resultReqDelayedEnergyOfW = await this.reqDelayedEnergyOfWMY(delay, 'week');
      const resultReqDelayedEnergyOfM = await this.reqDelayedEnergyOfWMY(delay, 'month');
      const resultReqDelayedEnergyOfY = await this.reqDelayedEnergyOfWMY(delay, 'year');
    }
               
    this.adapter.log.debug(`ecu.reqCyclicServices(${delay}, ${all}) - done`);        
  }

  /*
  */
  reqCyclicServices(intervalSec) {

    // intervalSec min 20sec, default 75sec
    let intervalMsec = 75 * 1000;
    if ( typeof(intervalSec) === 'number' && intervalSec != null ) {
      intervalMsec = (intervalSec < 20) ? 20000 : intervalSec * 1000;
    } 

    this.reqDelayedServices(2, true);

    this.timeoutCyclicRequests = setInterval( () => {
      //this.adapter.log.debug(`ecu.reqCyclicServices(setInterval() ...`);    
      this.reqDelayedServices(2, false);
    }, intervalMsec);
    this.adapter.log.debug(`ecu.reqCyclicServices(&{seconds}) - done`);    
  }


  

  /*
    Request SystemInfo service
    - This has to be the first service request to get the ecuId
    - skipped if response for previous request missed
   */
  reqSystemInfo() {
    if (!this.waitForResponse) { 
      this.waitForResponse = true;
      const req = REQ_SYSTEMINFO + REQ_END + "\r\n";
      this.client.write(req);
      this.adapter.log.debug("ecu.reqSystemInfo: " + req);
    }
  }

  /*
    Request RealTimeData service
    - request inverter data
    - skipped if response for previous request missed
   */
  reqRealTimeData() {
    if (!this.waitForResponse) { 
      if (this.ecuId != null) {
        const req = REQ_REAL_TIME_DATA + this.ecuId + REQ_END + "\r\n";
        this.waitForResponse = true;
        this.client.write(req);
        this.adapter.log.debug("reqRealTimeData: " + req);
      } else {
        this.adapter.log.error("Ecu.reqRealTimeData() - invalid ecuId: " + this.ecuId);
      }
    }
  }

  /*
    Request InverterSignalLevel service
    - skipped if response for previous request missed
   */
    reqInverterSignalLevel() {
      if (!this.waitForResponse) { 
        if (this.ecuId != null) {    
          const req = REQ_INVERTER_SIGNAL_LEVEL + this.ecuId + REQ_END + "\r\n";
          this.waitForResponse = true;             
          this.client.write(req);
          this.adapter.log.debug("reqInverterSignalLevel: " + req);
        } else {
          this.adapter.log.error("reqInverterSignalLevel() invalid ecuId: " + this.ecuId);
        }
      }
    }
  
  /*
    Request PowerOfDay service
    - request inverter data
    - skipped if response for previous request missed
    - todo parameter
   */
  reqPowerOfDay(day) {    // TODO
    day = (day != null) ? day : () => {
      let todayISO = (new Date()).toISOString();
      day = todayISO.substring(0,5) + todayISO.substring(5,7) + todayISO.substring(7,9);
    }; 

    if (!this.waitForResponse) { 
      if (this.ecuId != null) {    
        // todo parameter pruefen -> heute
        if (this.ecuId != null) {
          const req = REQ_POWER_OF_DAY + this.ecuId + REQ_END + day + REQ_END + "\r\n";
          this.waitForResponse = true;          
          this.client.write(req);
          this.adapter.log.debug("reqPowerOfDay: " + req);
        } else {
          this.adapter.log.error("reqPowerOfDay() invalid ecuId: " + this.ecuId);
        } 
      }
    }
  }

  
  /*
    Request reqEnergyOfWMY service
    - skipped if response for previous request missed
  */
  reqEnergyOfWMY(wmy) {
    let wmyStr = "nok"; // todo   wmy prüfen
    switch (wmy) {
      case "week":
        wmyStr = "00";
        break;

      case "month":
        wmyStr = "01";
        break;

      case "year":
        wmyStr = "02";
        break;

      default:
        // TODO
        break;
    }

    if (wmyStr != "nok") {
      if (!this.waitForResponse) { 
        if (this.ecuId != null) {    
          const req = REQ_ENERGY_OF_WMY + this.ecuId + REQ_END + wmyStr + REQ_END + "\r\n";
          this.waitForResponse = true;     
          this.client.write(req);
          this.adapter.log.debug("reqEnergyOfWMY: " + req);
        } else {
          this.adapter.log.debug("reqEnergyOfWMY() ecuId: " + this.ecuId);
        }
      }
    }
  }

  /*
   */
  decodeRsp = (ecuRsp) => {
    this.waitForResponse = false;  
    this.adapter.log.debug("ecu.rsp:" + bin2HexAscii(ecuRsp));

    let idx = 0;
    let commandNumber = this.decodeHdr(ecuRsp.subarray(idx, (idx += 13)));

    switch (commandNumber) {
      case "0001": // systeminfo
        this.decodeSystemInfo(ecuRsp.subarray(idx));
        break;
      case "0002": // realTimeData
        this.decodeRealTimeData(ecuRsp.subarray(idx));
        break;
      case "0003": // power of day
        this.decodePowerOfDay(ecuRsp.subarray(idx));
        break;
      case "0004": // energy of month / week / year
        this.decodeEnergyOfWMY(ecuRsp.subarray(idx));
        break;
      case "0030": // inverterSignalLevel
        this.decodeInverterSignalLevel(ecuRsp.subarray(idx, idx + 999));
        break;
      default:
        this.adapter.log.error(
          "decodeRsp: unknown commandNumber: " + commandNumber
        );
        break;
    }
  };

  /*
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
   */
  decodeSystemInfo(rsp) {
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

    this.showObj(sys, "hdr.", "sys.lastTimeConnectedEMA".length);

    this.adapter.setState("ecu.id", sys.id, true);
    this.adapter.setState("ecu.model", sys.model, true);
    this.adapter.setState("ecu.life_time_energy", sys.lifeTimeEnergy, true);
    this.adapter.setState("ecu.last_system_power", sys.lastSystemPower, true);
    this.adapter.setState("ecu.current_day_energy", sys.currentDayEnergy, true);
    this.adapter.setState("ecu.version", sys.version, true);
    this.adapter.setState("ecu.timeZone", sys.timeZone, true);
    this.adapter.setState("ecu.inverters", sys.inverters, true);
    this.adapter.setState("ecu.inverters_online", sys.invertersOnline, true);

    this.adapter.log.debug("rspSystemInfo - ok");
  }

  /*
   * Decode and process RealTimeData response 
   * @param { } [res]
   */
  decodeRealTimeData(rsp) {
    let idx = 0;
    let rtd = {};
    let inv = {};

    rtd.matchStatus = rsp.subarray(idx, (idx += 2)).toString();
    rtd.ecuModel = rsp.subarray(idx, (idx += 2)).toString();
    rtd.inverters = bin2int(rsp.subarray(idx, (idx += 2)));

    inv.dateTime = bcd2datetime(rsp.subarray(idx, (idx += 7)));

    for (let i = 1; i <= rtd.inverters; i++) {
      inv.inverterId = bcd2str(rsp.subarray(idx, (idx += 6)));
      inv.state = bin2int(rsp.subarray(idx, (idx += 1)));
      if (true /*inv.state == 1*/) {
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
            this.processRealTimeData(inv.inverterId, inv);
            break;
          default:
            // todo 
            break;
        }
      } else {
        // no inverter data
      }
    }

    this.showObj(rtd, "rtd.", "rtd.matchStatus".length);
    this.showObj(inv, "inv.", "inv.temperature".length);
  }

  processRealTimeData(inverterId, inv) {

    if (true /*inv.state == "01"*/) {
      switch (inv.inverterType) {
        case "01": { // YC600 todo  not jet supported
            let yc600Prefix = "inverters.yc600_" + inverterId;
            this.adapter.log.warn("rspRealTimeData.inverterType: " + inv.inverterType + " not supported");
          }
          break;

        case "02":  {// YC1000todo  not jet supported
            let yc1000Prefix = "inverters.yc1000_" + inverterId;
            this.adapter.log.warn("rspRealTimeData.inverterType: " + inv.inverterType + " not supported");
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
          this.adapter.log.error("rspRealTimeData.inverterType: " + inv.inverterType + " unknown");
          break;
      }
    }
    this.adapter.log.debug("rspRealTimeData - ok");
  }

  /*
   */
  decodePowerOfDay(rsp) {
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
    }

    this.adapter.setState("ecu.power_of_day_list", JSON.stringify(pow), true);

    this.showObj(pod, "pod.", "pod.status".length);
    this.adapter.log.debug("rspPowerOfDay - ok");
  }

  /*
   * Decode and process decodeEnergyOfWMY response
   * @param {} [rsp]
   */
  decodeEnergyOfWMY(rsp) {
    var idx = 0;
    let egy = {};
    let ewmy = {};

    egy.status = rsp.subarray(idx, (idx += 2)).toString();
    egy.energyWMY = rsp.subarray(idx, (idx += 2)).toString();

    if (egy.status == "00") {
      for (let len = rsp.subarray(idx).length - 4; len > 0; len -= 6) {
        ewmy[bcd2datetime(rsp.subarray(idx, (idx += 4)))] =
          bin2int(rsp.subarray(idx, (idx += 2))) / 100;
      }
    }

    switch (egy.energyWMY) {
      case "00":
        this.adapter.setState(
          "ecu.energy_of_week_list",
          JSON.stringify(ewmy),
          true
        );
        break;
      case "01":
        this.adapter.setState(
          "ecu.energy_of_month_list",
          JSON.stringify(ewmy),
          true
        );
        break;
      case "02":
        this.adapter.setState(
          "ecu.energy_of_year_list",
          JSON.stringify(ewmy),
          true
        );
        break;
      default:
        // todo
        break;
    }

    this.showObj(egy, "egy.", "egy.energyWMY".length);
    //this.showObj(ewmy);

    this.adapter.log.debug("rspEnergyOfWMY (" + egy.energyWMY + ") - ok");
  }

  /*
   * Decode and process InvertersSignalLevel response
   */
  decodeInverterSignalLevel(rsp) {
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

    this.showObj(isl, "isl.", "isl.inverterId".length);
    this.adapter.log.debug("rspInverterSignalLevel - ok");
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

/*
 */
disconnect() {
  this.client.on("end", function () {
    console.log("ecu.end");
  });
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
