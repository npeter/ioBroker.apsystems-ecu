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
This adapter integrates [APSystems](https://apsystems.com/) inverters via APSystems ECU-R/ECU-B communication unit to collect data from solar modules. 
The adapter queries the local ECU using the proprietary APSytems ECU to EMAapp protocol. It collects realtime information and history data from the ECU about the configured inverters.
The ECU supports several connections and protocols on its LAN and WLAN interface. This implementation is focused on the services available via WLAN TCP port 8899 and the so called command group 11 of the ECU.<br>
<br>
## Many Thanks ...
This project was only possible because of the great protocol analysis work of @checking12, @HAEdwin and other people on the home assistant forum. 
<br>
There exists already a Python implementation for home assistant 
[ksheumaker/homeassistant-apsystems_ecur](https://github.com/ksheumaker/homeassistant-apsystems_ecur) which was used to get a better understanding of the ECU behavior. 
See also the discussion in [APsystems APS ECU R local inverters data pull](https://community.home-assistant.io/t/apsystems-aps-ecu-r-local-inverters-data-pull/260835/141) for more details. 
<br>
*apsystems-ecu* is a new development in JavaScript for iobroker.
<br>
<br>
## How it works
The ECU has to run in its 'normal mode' and has to be connected to the local network and the internet. A connection to the EMA cloud seems to be needed or the Ecu will not offer the used services (but this was not deeper investigated). In my system only the WLAN interface of the Ecu is used. The usage of the LAN interface was not investigated.
<br>
The Ecu uses [zigbee](https://en.wikipedia.org/wiki/Zigbee) to communicate with the configured inverters. The poll time of the Ecu to inverter communication in smaller systems is normally 300sec.
It's reported that the cycle time will increase in bigger systems but I could not investigated. 
<br>
The adapter connects cyclic to the Ecu via TCP port 8899 (default) (port and IP address can be configured) and collects data. The adapter poll time can be configured. Received data used to update the iobroker database. Objects and states are automatically created if new devices (inverters) are online. 
<br>


Remark: 
 - The setup of the Ecu, the inverters and the connection to the EMA cloud is not part of this project.
 - The adapter was developed and tested with a small system with one QS1 inverter only. 
 - Tests with YC600, YC1000, DS3, ECU-B are done with support of some users.
<br>
<br>

## Suported devices and services 

### Communication units:
- ECU-R - OK
- ECU-C - may work but not tested
- ECU-B - OK (may depent on firmware version)

### Inverters:
- QS1 - OK 
- YC600 - OK 
- YC1000 - OK
- DS3 - OK 

## Interface and protocol

Only the following interface and protocol is supported
- WLAN
- TCP port 8899
- Command group 11 and 12 (only GetEnergyOfWeekMonthYear) 
<br>
<br>

## Functions overview

* Implementation of all (known) command group 11 services
  * *GetSystemInfo*, *GetRealTimeData*, *GetInverterData*SERVICE_COUNT_ID, *GetPowerOfDay*
  * *GetEnergyOfWeekMonthYear* - no more supported by ECU with firmware version > 2.x
  * Decoding and storing of all data offered by these services
  * New! Support of command group 12 GetEnergyOfWeekMonthYear service
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
  * Support depents on ECU firmware version
  * disable/enable with config parameter extendedService 
  * Once requested at adapter start
  * Request by user command
    * *cmd_energy_of_week*=true
    * *cmd_energy_of_month*=true
    * *cmd_energy_of_year*=true
<br>
<br>

* The adapter computes sunrise and sunset based on the iobroker system settings at midnight.
    * ECU polling is stopped at sunset and started at sunrise 

# Appendix
<br>

## Links

There are several projects about APsystems Inverters available using different interfaces.
<br>
Just an incomplete list of links ...



* [Collect inverter data via zigbee using Fake ECU](https://github.com/Koenkk/zigbee2mqtt/issues/4221)

* [ksheumaker/homeassistant-apsystems_ecur](https://github.com/ksheumaker/homeassistant-apsystems_ecur)

* [bgbraga/homeassistant-apsystems ](https://github.com/bgbraga/homeassistant-apsystems)

* [Extracting data from APsystems inverters via EMA cloud](https://medium.com/@rukmalf/extracting-data-from-apsystems-inverters-8c2b8e8942b6)     
<br>
<br>

## ECU-R behaviour
* The typical ECU-R response time in my configuration is <50ms (see debug log) 
* I got regular a socket error (remote close) after communication pause > 15sec between service requests
    * Enabling keep-alive did't improve this behavior
    * So TCP connection is opened and closed for each communication service to avoid remote close 
<br><br><br>

## APSystems ECU Protocol - Command Group 11
<br>

### GetSystemInfo
<br>

Request: "APS1100160001END\n"
<br>

| Response | Start Index   | Length | Coding | Name                 | Remark                  |
| -------- | ------------- | ------ | ------ | -------------------- | ----------------------- |
| Header   |               |        |        |                      |                         |
|          | 0             | 3      | ASCII  | SignatureStart       | always "APS"            |
|          | 3             | 2      | ASCII  | CommandGroup         | always"11"              |
|          | 5             | 4      | ASCII  | ResponseLenght       | from "APS" to "END"     |
|          | 9             | 4      | ASCII  | CommandCode          | "0001" - GetSystem Info |
| ECU data |               |        |        |                      |                         |
|          | 13            | 12     | ASCII  | ECU-Id               |                         |
|          | 25            | 2      | ASCII  | ECIModel             |                         |
|          | 27            | 4      | HEX    | LifeTimeEnergy       | /10 kWh                 |
|          | 31            | 4      | HEX    | LastSystemPower      | W                       |
|          | 35            | 4      | HEX    | CurrentDayEnergy     | /100 - kWh              |
|          | 39            | 7      | BCD    | LastTimeConnectedEMA | always D0D0D0D0D0D0     |
|          | 46            | 2      | HEX    | Inverters            |                         |
|          | 48            | 2      | HEX    | InvertersOnline      |                         |
|          | 50            | 2      | ASCII  | EcuChannel           | always "10"             |
|          | 52            | 3      | ASCII  | VersionLength (vlen) | e.c. "014"              |
|          | 55            | vlen   | ASCII  | Version              | e.c. "ECU\_R\_1.2.17T4"  |
|          | 55+vlen       | 3      | ASCII  | TimeZoneLen (tzlen)  | e.c. "009"              |
|          | 58+vlen       | tzlen  | ASCII  | TimeZone             | (always?) "Utc/GMT-8"        |
|          | 58+vlen+tzlen | 6      | HEX    | EthernetMAC          |                         |
|          | 64+vlen+tzlen | 6      | HEX    | WirelessMAC          |                         |
| Footer   |               |        |        |                      |                         |
|          | 70+vlen+tzlen | 3      | ASCII  | SignaturStop         | always "END"            |
|          | 73+vlen+tzlen | 1      | ASCII  |                      | always "\\n"            |
<br>

### GetRealTimeData
<br>

Request: "APS110028000221600xxxxxxxEND\n" where 21600xxxxxx=ECUId
<br>

| Response          | Start Index                   | Length | Coding | Name           | Remark                            |
| ----------------- | ----------------------------- | ------ | ------ | -------------- | --------------------------------- |
| Header            |                               |        |        |                |                                   |
|                   | 0                             | 3      | ASCII  | SignatureStart | always "APS"                      |
|                   | 3                             | 2      | ASCII  | CommandGroup   | always"11"                        |
|                   | 5                             | 4      | ASCII  | ResponseLenght    |  from "APS" to "END"                                 |
|                   | 9                             | 4      | ASCII  | CommandCode    | "0002" - GetRealTimeData          |
|                   | 13                            | 2      | ASCII  | MatchStatus    | "00"/"01" - ok/no data                          |
| Common Data       |                               |        |        |                |
|                   | 15                            | 2      | ASCII  | EcuModel       |                                   |
|                   | 17                            | 2      | HEX    | Inverters      | Nuber of inverter entries in RSP  |
|                   | 19                            | 7      | BCD    | DateTime       |                                   |
| entry for each inverter |                               |        |        |                |
|                   | common for all Inverter       |        |        |
|                   | 26                            | 6      | ASCII  | InverterId     | "408000xxxxxx"                    |
|                   | 32                            | 1      | HEX    | State          | 0x00/0x01 - offline/online        |
|                   | 33                            | 2      | ASCII  | InverterType   | "00/"01"/"02"/"03" - unknown/YC600,DS3/YC1000/QS1 |
|                   | common if InverterType == "01"/"02"/"03"
|                   | 35                            | 2      | HEX    | Frequency      | *0.*1 - Hz                        |
|                   | 37                            | 2      | HEX    | Temperature    | \-100 - °C                        |
|                   | if YC600 or DS3               |        |        |                |                                   |
|                   | 39                            | 2      | HEX    | Power1         |                                   |
|                   | 41                            | 2      | HEX    | AcVoltage1     |                                   |
|                   | 43                            | 2      | HEX    | Power2         |                                   |
|                   | 45                            | 2      | HEX    | AcVoltage2     |                                   |
|                   | if YC1000                     |        |        |                |                                   |
|                   | 39                            | 2      | HEX    | Power1         |                                   |
|                   | 41                            | 2      | HEX    | AcVoltage1     |                                   |
|                   | 43                            | 2      | HEX    | Power2         |                                   |
|                   | 45                            | 2      | HEX    | AcVoltage2     |                                   |
|                   | 47                            | 2      | HEX    | Power3         |                                   |
|                   | 49                            | 2      | HEX    | AcVoltage3     |                                   |
|                   | 51                            | 2      | HEX    | notclear       |                                   |
|                   | if QS1                        |        |        |                |                                   |
|                   | 39                            | 2      | HEX    | Power1         |                                   |
|                   | 41                            | 2      | HEX    | AcVoltage      |                                   |
|                   | 43                            | 2      | HEX    | Power2         |                                   |
|                   | 45                            | 2      | HEX    | Power3         |                                   |
|                   | 47                            | 2      | HEX    | Power4         |                                   |
|                   | …                             |        |        |                |                                   |
| Footer            |                               |        |        |                |                                   |
|                   | len-4                         | 3      | ASCII  | SignatureStop  | always "END"                      |
|                   | len-1                         | 1      | ASCII  |                | always "\\n"                      |
<br>
Inverter Id's
| Type | Id-Prefix
| YC600  | "40xxxxxxxxxxx"
| YC1000 | "50xxxxxxxxxxx" 
| DS2    | "70xxxxxxxxxxx" 
| QS1    | "80xxxxxxxxxxx"
<br>
### GetPowerOfDay 
<br>

Request: "APS110039000321600xxxxxxxENDddddddddEND\n" where 21600xxxxxxx=ECUId dddddddd=Date (BCD e.c. 20220209)
<br>

| Response             | Start Index | Length | Coding | Name           | Remark                            |
| -------------------- | ----------- | ------ | ------ | -------------- | --------------------------------- |
| Header               |             |        |        |                |                                   |
|                      | 0           | 3      | ASCII  | SignatureStart | always "APS"                      |
|                      | 3           | 2      | ASCII  | CommandGroup   | always"11"                        |
|                      | 5           | 4      | ASCII  | ResponseLenght    | from "APS" to "END"                                  |
|                      | 9           | 4      | ASCII  | CommandCode    | "0003" - GetEnergyOfWeekMonthYear |
|                      | 13          | 2      | ASCII  | MatchStatus    | "00"/"01" - ok/no data                          |
| for each power value |             |        |        |                |
|                      | 15          | 2      | BCD    | Time           |                                   |
|                      | 17          | 2      | HEX    | PowerOfDay     |                                   |
|                      | …           |        |        |                |                                   |
| Footer               |             |        |        |                |                                   |
|                      | len-4       | 3      | ASCII  | SignatureStop  | always "END"                      |
|                      | len-1       | 1      | ASCII  |                | always "\\n"                      |
<br>

### GetEnergyOfWeekMonthYear (suport depents on ECU type and firmware version)
<br> 

Request: "APS110039000421600xxxxxxxENDppEND\n" where 21600xxxxxxx=ECUId, pp=Period ("00"/"01"/"02" - week/month/year)
<br>

| Response             | Start Index | Length | Coding | Name           |                                   |
| -------------------- | ----------- | ------ | ------ | -------------- | --------------------------------- |
| Header               |             |        |        |                |                                   
|                      | 0           | 3      | ASCII  | SignatureStart | always "APS"                      
|                      | 3           | 2      | ASCII  | CommandGroup   | "11" or "12"                      
|                      | 5           | 4      | ASCII  | ResponseLenght   |                                   
|                      | 9           | 4      | ASCII  | CommandCode    | "0004" - GetEnergyOfWeekMonthYear 
|                      | 13          | 2      | ASCII  | MatchStatus    | "00"/"01" - ok/no data                         
| Common Data          |             |        |        |                |
|                      | 15          | 2      | ASCII  | WeekMonthYear  | 00=week, 01=month, 02=year        
| for each power value |             |        |        |                |
|                      | 17          | 4      | BCD    | Date           | yyymmdd                           
|                      | 21          | 2      | HEX    | PowerOfDay     | if  CommandGroup 11
|                      | 21          | 4      | HEX    | PowerOfDay     | if  CommandGroup 12
|                      | …           |        |        |                |                                   
| Footer               |             |        |        |                |                                   
|                      | len-4       | 3      | ASCII  | SignatureStop  | always "END"                      
|                      | len-1       | 1      | ASCII  |                | always "\\n"                      
<br>

### GetInverterSignalLevel
<br>

Request: "APS110028000421600xxxxxxxEND\n" where 21600xxxxxxx=ECUId
<br>

| Response          | Start Index | Length | Coding | Name           |                            |
| ----------------- | ----------- | ------ | ------ | -------------- | -------------------------- |
| Header            |             |        |        |                |                            |
|                   | 0           | 3      | ASCII  | SignatureStart | always "APS"               |
|                   | 3           | 2      | ASCII  | CommandGroup   | always"11"                 |
|                   | 5           | 4      | ASCII  | ResponseLenght    |  from "APS" to "END"                          |
|                   | 9           | 4      | ASCII  | CommandCode    | "0030" - GetInverterSignal |
|                   | 13          | 2      | ASCII  | MatchStatus    | "00"/"01" - ok/no data                 |
| for each inverter |             |        |        |                |
|                   | 17          | 6      | BCD    | InverterId     | yyymmdd                    |
|                   | 21          | 1      | HEX    | SignalLevel    |                            |
|                   | …           |        |        |                |                            |
| Footer            |             |        |        |                |                            |
|                   | len-4       | 3      | ASCII  | SignatureStop  | always "END"               |
|                   | len-1       | 1      | ASCII  |                | always "\\n"               |


## Changelog

### 0.2.10 (npeter) (23-10-10)
1. README.md GetEnergyOfWeekMonthYear CommandCode corrected (0040->0004); Some improvements
2. issue#16: Support of GetEnergyOfWeekMonthYear response with CommandGroup 12
3. issue#12: New state rssi in inverter object. rssi is inverter signal_level in dBm it will replace signal_level in future versions
4. issue#13, issue15 README.md some typos and errors corrected 
5. Admin/index_n.html description for extended_service improved

### 0.2.9 (npeter) (in work 22-04-14)
* Service response status check about  "no data" added/improved 
* Response length check improved
* New config parameter *extended_service* to disable/enable GetEnergyOfWeekMonthYear service processing
  * avoid warnings if firmware support for GetEnergyOfWeekMonthYear service is missed
  * checked:  GetEnergyOfWeekMonthYear states created and services executed 
  * not checked (default): GetEnergyOfWeekMonthYear services are skiped and states not created
* Config parameter *pollAlways* removed
* README.md Request for GetPowerOfDay and GetEnergyOfWeekMonthYear corrected
* \r replaced by \n in "const req = REQ_POWER_OF_DAY + this.ecuId + REQ_END + day + REQ_END + '\n';"

### 0.2.8 (npeter) (in work 22-03-27-B)
* Testversion for [#8](https://github.com/npeter/ioBroker.apsystems-ecu/issues/8)
  * DS3 states Power1/2, and Voltage1/2 added - correction of 0.2.7

### 0.2.7 (npeter) (in work 22-03-27)
* Testversion for [#8](https://github.com/npeter/ioBroker.apsystems-ecu/issues/8)
  * DS3 states Power1/2, and Voltage1/2 added

### 0.2.6 (npeter) (in work 22-03-26)
* Testversion for [#8](https://github.com/npeter/ioBroker.apsystems-ecu/issues/8)
  * YC600 and DS3 identfication corrected

### 0.2.5 (npeter) (in work 22-03-25)
* Testversion for [#8](https://github.com/npeter/ioBroker.apsystems-ecu/issues/8)
  * ECU connect/disconect for each service
    * "ECU intervall" is used as delay between service calls instead of delay between ECU polling
      * SystemInfo - delay - GetRealTimeData - delay - GetInverterSignalLevel - delay - [GetPowerOfDay - delay -] [...] 
    * Service error is ignored (no repeat) 
* Support of DS3 
  * Device with "ds3" prefix created
* Correct processing of "only registered" inverters
  * No devices and states created
* GetRealTimeData protocoll doc improved (DS3 and only registered inverters)
* ECU Version added to SystemInfo debug log

### 0.2.4 (npeter) (in work 22-03-09)
* new configuration.poll_always added (test)
  * poll_always will disable stopping of ECU polling at sunset

### 0.2.3 (npeter) (in work 22-03-09)
* new state ecu.total_energy_yesterday (issue [#5](https://github.com/npeter/ioBroker.apsystems-ecu/issues/5))
  * ecu.current_day_energy stored in ecu.total_energy_yesterday at midnight
  * Remark: ecu.current_day_energy is reset by ECU 
* info.service_count set to 0 at midnight
* new state ecu.dc_peak_power_yesterday 
  * update with ecu.dc_peak_power_today at midnight
* new state ecu.dc_peak_power_today (drag indicator) (issue [#4](https://github.com/npeter/ioBroker.apsystems-ecu/issues/4))
  * peak of dc_power of all inverters (GetRealTimeData)
  * reset at midnight

### 0.2.2 (npeter)
* issues [#2](https://github.com/npeter/ioBroker.apsystems-ecu/issues/2), [#3](https://github.com/npeter/ioBroker.apsystems-ecu/issues/3) solved and closed
* YC600 and YC1000 states dc_voltage(n) changed to ac_voltage(n)
* README.md  
    * protocol description adapted
    * some improvements and corrections

    
### 0.2.1 (npeter)
* README.md improved
* [ Inverter state values wrong if multiple inverters connected #1 ](https://github.com/npeter/ioBroker.apsystems-ecu/issues/1) solved
### 0.2.0 
* (npeter) First alpha version

### 0.1.0 
* (npeter) initial commit on githup as public project

### 0.0.1
* (npeter) initial prototype
<br>
<br>

## License
MIT License - Copyright (c) 2021-2022 npeter <peter_n@gmx.de>

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
