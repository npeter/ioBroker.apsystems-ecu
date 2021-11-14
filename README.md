![Logo](admin/apsystems-ecu.png)
# ioBroker.apsystems-ecu  alpha-version

[![NPM version](http://img.shields.io/npm/v/iobroker.apsystems-ecu.svg)](https://www.npmjs.com/package/iobroker.apsystems-ecu)
[![Downloads](https://img.shields.io/npm/dm/iobroker.apsystems-ecu.svg)](https://www.npmjs.com/package/iobroker.apsystems-ecu)
![Number of Installations (latest)](http://iobroker.live/badges/apsystems-ecu-installed.svg)
![Number of Installations (stable)](http://iobroker.live/badges/apsystems-ecu-stable.svg)
[![Dependency Status](https://img.shields.io/david/npeter/iobroker.apsystems-ecu.svg)](https://david-dm.org/npeter/iobroker.apsystems-ecu)
[![Known Vulnerabilities](https://snyk.io/test/github/npeter/ioBroker.apsystems-ecu/badge.svg)](https://snyk.io/test/github/npeter/ioBroker.apsystems-ecu)

[![NPM](https://nodei.co/npm/iobroker.apsystems-ecu.png?downloads=true)](https://nodei.co/npm/iobroker.apsystems-ecu/)

## Integration of APSystems inverters via ECU-R 
This adapter integrates [APSystems](https://apsystems.com/) inverters via APSystems ECU-R communication unit to collect data from solar modules. 
The adapter queries the local ECU-R using the proprietary APSytems ECU to EMAapp protocol. It collects realtime information and history data about the ECU and about the configured inverters.
The ECU supports several connections and protocols on its LAN and WLAN interface. This implementation supports only communication via TCP port 8899 and the so called command group 11.<br>
<br>
## Many Thanks ...
This project was only possible because of the great protocol analysis work of @checking12, @HAEdwin and other people on the home assistant forum. 
<br>
There exists also already a Python implementation for home assistant 
[ksheumaker/homeassistant-apsystems_ecur](https://github.com/ksheumaker/homeassistant-apsystems_ecur) which was used to get a better understanding of the  of the ECU behavior. 
See also the discussion in [APsystems APS ECU R local inverters data pull](https://community.home-assistant.io/t/apsystems-aps-ecu-r-local-inverters-data-pull/260835/141) for more details.
<br>
<br>
## How it works
The ECU has to run in its 'normal mode' and has to be connected to the local network and the internet. A connection to the EMA cloud seems to be needed or the Ecu will not offer the used interface (but this was not deeper investigated). In my system only the WLAN interface of the Ecu is used. The usage of the LAN interface was not investigated.
<br>
The cycle time can be configured. The Ecu uses [zigbee](https://en.wikipedia.org/wiki/Zigbee) to communicate with the configured inverters. The typ. cycle time of the Ecu to inverter communication in smaller systems is normally 300sec.
It's reported that the cycle time will increase in bigger systems but I could not investigated. 
<br>
The adapter connects cyclic to the Ecu via TCP port 8899 (default) (port and IP address can be configured) and collects data. The cycle time can be configured. In each cycle several services are called. Received data used to update the database. Objects and states are automatically created if new devices (inverters) are online. 
<br>


Remark: 
 - The setup of the Ecu, the inverters and the connection to the EMA cloud is not part of this project.
 - Till now the adapter was developed and tested with a small system with one Qs1 inverter only. Its prepared for other inverter types and multiple inverters but not tested.
<br>
<br>
## Suported devices and services 
<br>

### Communication units:
- ECU-R - tested
- ECU-C - may work but not tested
- ECU-B (not clear)

### Inverters:
- QS1 - single device tested
- YC600 - not tested
- YC1000 - not tested
- Remark: The implementation is prepared for YC600, YC1000 and multiple inverters in any combination  but not tested yet. 

## Interface and protocol

Only the following interface and protocol is supported
- WLAN
- TCP port 8899
- Command group 11
<br>
<br>

## Functions overview

* Implementation of all (known) command group 11 services
  * *GetSystemInfo*, *GetRealTimeData*, *GetInverterData*, *GetPowerOfDay*, *GetEnergyOfWeekMonthYear*
  * Decoding and storing of all data offered by these services
<br>
<br>
* Cyclic request of realtime services *GetSystemInfo*, *GetRealTimeData* and *GetInverterSignalLevel*
  * Start/Stop of cyclic service execution by user
    * *cmd_start_stop*=true/false 
  * Cyclic requests are automatically disabled between sunset and sunrise
    * Longitude and latitude from system configuration used 
<br>
<br>
* Calling *GetPowerOfDay* service by command
  * Selectable day *power_of_day_date* for power data
  * Once requested at adapter start
  * Request by user command
    * *cmd_power_of_day*=true
    * *power_of_day_date* changed
<br>
<br>
* Calling *GetEnergyOfWeekMonthYear* service by command
  * Once requested at adapter start
  * Request by user command
    * *cmd_energy_of_week*=true
    * *cmd_energy_of_month*=true
    * *cmd_energy_of_year*=true
<br>
<br>
* Supported Inverters
  * Several inverter types are in principle supported
  * But as of the limited availability ...
    * QS1 (only tests with one connected inverter)
    * YC600 (not tested)
    * YC1000 (not tested)
    * Extension of the test coverage with external support possible
<br>
<br>
## Apendix
There are several projects about APsystems Inverters available using different interfaces.
<br>
Just an incomplete list of links ...



[Collect inverter data via zigbee using Fake ECU](https://github.com/Koenkk/zigbee2mqtt/issues/4221)

[ksheumaker/homeassistant-apsystems_ecur](https://github.com/ksheumaker/homeassistant-apsystems_ecur)

[bgbraga/homeassistant-apsystems ](https://github.com/bgbraga/homeassistant-apsystems)

[Extracting data from APsystems inverters via EMA cloud](https://medium.com/@rukmalf/extracting-data-from-apsystems-inverters-8c2b8e8942b6) 
    
<br>
<br>    
## Changelog

### 0.2.0 
* (npeter) First alpha version
### 0.1.0 
* (npeter) initial commit on githup as public project
### 0.0.1
* (npeter) initial prototype
<br>
<br>

## License
MIT License - Copyright (c) 2021 npeter <peter_n@gmx.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
<br>
