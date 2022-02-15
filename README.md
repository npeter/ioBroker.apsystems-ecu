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
The adapter queries the local ECU-R using the proprietary APSytems ECU to EMAapp protocol. It collects realtime information and history data from the ECU about the configured inverters.
The ECU supports several connections and protocols on its LAN and WLAN interface. This implementation is focused on the services available via WLAN TCP port 8899 and the so called command group 11 of the ECU.<br>
<br>
## Many Thanks ...
This project was only possible because of the great protocol analysis work of @checking12, @HAEdwin and other people on the home assistant forum. 
<br>
There exists already a Python implementation for home assistant 
[ksheumaker/homeassistant-apsystems_ecur](https://github.com/ksheumaker/homeassistant-apsystems_ecur) which was used to get a better understanding of the ECU behavior. 
See also the discussion in [APsystems APS ECU R local inverters data pull](https://community.home-assistant.io/t/apsystems-aps-ecu-r-local-inverters-data-pull/260835/141) for more details. But this is a new development in JavaScript for iobroker.
<br>
<br>
## How it works
The ECU has to run in its 'normal mode' and has to be connected to the local network and the internet. A connection to the EMA cloud seems to be needed or the Ecu will not offer the used services (but this was not deeper investigated). In my system only the WLAN interface of the Ecu is used. The usage of the LAN interface was not investigated.
<br>
The cycle time can be configured. The Ecu uses [zigbee](https://en.wikipedia.org/wiki/Zigbee) to communicate with the configured inverters. The typ. cycle time of the Ecu to inverter communication in smaller systems is normally 300sec.
It's reported that the cycle time will increase in bigger systems but I could not investigated. 
<br>
The adapter connects cyclic to the Ecu via TCP port 8899 (default) (port and IP address can be configured) and collects data. The cycle time can be configured. In each cycle several services are called. Received data used to update the database. Objects and states are automatically created if new devices (inverters) are online. 
<br>


Remark: 
 - The setup of the Ecu, the inverters and the connection to the EMA cloud is not part of this project.
 - The adapter was developed and tested with a small system with one QS1 inverter only. 
 - Further tests (4 * YC600) are done with the support of [bu.na](https://forum.iobroker.net/uid/45697) .
 - It's also prepared for YC1000 inverters and system with several types but not jet tested.
 - The state "info/timeZone" is part of the ECU SystemInfo-Response. It's always "Etc/GMT-8" which seems to be the default value (my assumtion).
<br>
<br>

## Suported devices and services 

### Communication units:
- ECU-R - tested (FW ECU_R_1.2.19)
- ECU-C - may work but not tested
- ECU-B - not supported

### Inverters:
- QS1 - single device tested
- YC600 - multiple inverters tested
- YC1000 - not tested
- Remark: The implementation is prepared for YC600, YC1000 and multiple inverters in any combination  but not fully tested. 

## Interface and protocol

Only the following interface and protocol is supported
- WLAN
- TCP port 8899
- Command group 11
<br>
<br>

## Functions overview

* Implementation of all (known) command group 11 services
  * *GetSystemInfo*, *GetRealTimeData*, *GetInverterData*SERVICE_COUNT_ID, *GetPowerOfDay*, *GetEnergyOfWeekMonthYear*
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
    * So TCP connection is opened and closed for each communication cyclic to avoid remote close 
<br><br><br>

## APSystems ECU-R Protocol - Command Group 11
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
|          | 5             | 4      | ASCII  | FrameLength          |                         |
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
| Fooder   |               |        |        |                      |                         |
|          | 70+vlen+tzlen | 3      | ASCII  | SignaturStop         | always "END"            |
|          | 73+vlen+tzlen | 1      | ASCII  |                      | always "\\n"            |
<br>

### GetRealTimeData
<br>

Request: "APS110028000221600xxxxxxEND\n" where 21600xxxxxx=ECUId
<br>

| Response          | Start Index                   | Length | Coding | Name           | Remark                            |
| ----------------- | ----------------------------- | ------ | ------ | -------------- | --------------------------------- |
| Header            |                               |        |        |                |                                   |
|                   | 0                             | 3      | ASCII  | SignatureStart | always "APS"                      |
|                   | 3                             | 2      | ASCII  | CommandGroup   | always"11"                        |
|                   | 5                             | 4      | ASCII  | FrameLength    |                                   |
|                   | 9                             | 4      | ASCII  | CommandCode    | "0002" - GetRealTimeData          |
|                   | 13                            | 2      | ASCII  | MatchStatus    | "00" - OK                         |
| Common Data       |                               |        |        |                |
|                   | 15                            | 2      | ASCII  | EcuModel       |                                   |
|                   | 17                            | 2      | HEX    | Inverters      |                                   |
|                   | 19                            | 7      | BCD    | DateTime       |                                   |
| for all inverters |                               |        |        |                |
|                   | common for all Inverter types |        |        |
|                   | 26                            | 6      | ASCII  | InverterId     | "408000xxxxxx"                    |
|                   | 32                            | 1      | HEX    | State          | 0x01 - online                     |
|                   | 33                            | 2      | ASCII  | InverterType   | "01"/"02"/"03" - YC600/YC1000/QS1 |
|                   | 35                            | 2      | HEX    | Frequency      | /10 - Hz                          |
|                   | 37                            | 2      | HEX    | Temperature    | \-100 - °C                        |
|                   | if YC600                      |        |        |                |                                   |
|                   | 39                            | 2      | HEX    | Power1         |                                   |
|                   | 41                            | 2      | HEX    | AcVoltage1       |                                |
|                   | 43                            | 2      | HEX    | Power2         |                                   |
|                   | 45                            | 2      | HEX    | AcVoltage2       |                               |
|                   | if YC1000                     |        |        |                |                                   |
|                   | 39                            | 2      | HEX    | Power1         |                                   |
|                   | 41                            | 2      | HEX    | AcVoltage1       |                               |
|                   | 43                            | 2      | HEX    | Power2         |                                   |
|                   | 45                            | 2      | HEX    | AcVoltage2       |                               |
|                   | 47                            | 2      | HEX    | Power3         |                                   |
|                   | 49                            | 2      | HEX    | AcVoltage3       |                               |
|                   | 51                            | 2      | HEX    | notclear       |                                   |
|                   | if QS1                        |        |        |                |                                   |
|                   | 39                            | 2      | HEX    | Power1         |                                   |
|                   | 41                            | 2      | HEX    | AcVoltage      |                                   |
|                   | 43                            | 2      | HEX    | Power2         |                                   |
|                   | 45                            | 2      | HEX    | Power3         |                                   |
|                   | 47                            | 2      | HEX    | Power4         |                                   |
|                   | …                             |        |        |                |                                   |
| Fooder            |                               |        |        |                |                                   |
|                   | len-4                         | 3      | ASCII  | SignatureStop  | always "END"                      |
|                   | len-1                           | 1      | ASCII  |                | always "\\n"                      |
<br>

### GetPowerOfDay 
<br>

Request: "APS110039000321600xxxxxxENDdddddddd\n" where 21600xxxxxx=ECUId dddddddd=Date (BCD e.c. 20220209)
<br>

| Response             | Start Index | Length | Coding | Name           | Remark                            |
| -------------------- | ----------- | ------ | ------ | -------------- | --------------------------------- |
| Header               |             |        |        |                |                                   |
|                      | 0           | 3      | ASCII  | SignatureStart | always "APS"                      |
|                      | 3           | 2      | ASCII  | CommandGroup   | always"11"                        |
|                      | 5           | 4      | ASCII  | FrameLength    |                                   |
|                      | 9           | 4      | ASCII  | CommandCode    | "0003" - GetEnergyOfWeekMonthYear |
|                      | 13          | 2      | ASCII  | MatchStatus    | "00" - OK                         |
| for each power value |             |        |        |                |
|                      | 15          | 2      | BCD    | Time           |                                   |
|                      | 17          | 2      | HEX    | PowerOfDay     |                                   |
|                      | …           |        |        |                |                                   |
| Fooder               |             |        |        |                |                                   |
|                      | len-4       | 3      | ASCII  | SignatureStop  | always "END"                      |
|                      | len-1         | 1      | ASCII  |                | always "\\n"                      |
<br>

### GetEnergyOfWeekMonthYear
<br> 

Request: "APS110039000421600xxxxxxENDpp\n" where 21600xxxxxx=ECUId, pp=Period ("00"/"01"/"02" - week/month/year)
<br>

| Response             | Start Index | Length | Coding | Name           |                                   |
| -------------------- | ----------- | ------ | ------ | -------------- | --------------------------------- |
| Header               |             |        |        |                |                                   |
|                      | 0           | 3      | ASCII  | SignatureStart | always "APS"                      |
|                      | 3           | 2      | ASCII  | CommandGroup   | always"11"                        |
|                      | 5           | 4      | ASCII  | FrameLength    |                                   |
|                      | 9           | 4      | ASCII  | CommandCode    | "0040" - GetEnergyOfWeekMonthYear |
|                      | 13          | 2      | ASCII  | MatchStatus    | "00" - OK                         |
| Common Data          |             |        |        |                |
|                      | 15          | 2      | ASCII  | WeekMonthYear  | 00=week, 01=month, 02=year        |
| for each power value |             |        |        |                |
|                      | 17          | 4      | BCD    | Date           | yyymmdd                           |
|                      | 21          | 2      | HEX    | PowerOfDay     |                                   |
|                      | …           |        |        |                |                                   |
| Fooder               |             |        |        |                |                                   |
|                      | len-4       | 3      | ASCII  | SignatureStop  | always "END"                      |
|                      | len-1         | 1      | ASCII  |                | always "\\n"                      |
<br>

### GetInverterSignalLevel
<br>

Request: "APS110028000421600xxxxxxEND\n" where 21600xxxxxx=ECUId
<br>

| Response          | Start Index | Length | Coding | Name           |                            |
| ----------------- | ----------- | ------ | ------ | -------------- | -------------------------- |
| Header            |             |        |        |                |                            |
|                   | 0           | 3      | ASCII  | SignatureStart | always "APS"               |
|                   | 3           | 2      | ASCII  | CommandGroup   | always"11"                 |
|                   | 5           | 4      | ASCII  | FrameLength    |                            |
|                   | 9           | 4      | ASCII  | CommandCode    | "0030" - GetInverterSignal |
|                   | 13          | 2      | ASCII  | MatchStatus    | "00" - OK                  |
| for each inverter |             |        |        |                |
|                   | 17          | 6      | BCD    | InverterId     | yyymmdd                    |
|                   | 21          | 1      | HEX    | SignalLevel    |                            |
|                   | …           |        |        |                |                            |
| Fooder            |             |        |        |                |                            |
|                   | len-4       | 3      | ASCII  | SignatureStop  | always "END"               |
|                   | len-1         | 1      | ASCII  |                | always "\\n"               |


## Changelog

### 0.2.3 (npeter) (in work)
* new state ecu.total_energy_yesterday
    * ecu.current_day_energy stored in ecu.total_energy_yesterday at midnight
    * Remark: ecu.current_day_energy has to be reset by ECU
* info.service_count set to 0 at midnight
* new state ecu.dc_peak_power_today (drag indicator)
    * peak of sum of dc_power of all inverters (GetRealTimeData)
    * reset at midnight
* new state ecu.dc_peak_power_yesterday 
    * value of dc_peak_power_today at midnight
* if inverter offline inverter.dc_power(n) and inverter.ac_voltage(n) set to 0 
    * GetRealTimeData-Response-Data not used
    * Remark: no reset of inverter.frequency and inverter.temperature by the adapter
    * Todo this has to be analyzed!
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
