![Logo](admin/apsystems-ecu.png)
# ioBroker.apsystems-ecu

[![NPM version](http://img.shields.io/npm/v/iobroker.apsystems-ecu.svg)](https://www.npmjs.com/package/iobroker.apsystems-ecu)
[![Downloads](https://img.shields.io/npm/dm/iobroker.apsystems-ecu.svg)](https://www.npmjs.com/package/iobroker.apsystems-ecu)
![Number of Installations (latest)](http://iobroker.live/badges/apsystems-ecu-installed.svg)
![Number of Installations (stable)](http://iobroker.live/badges/apsystems-ecu-stable.svg)
[![Dependency Status](https://img.shields.io/david/npeter/iobroker.apsystems-ecu.svg)](https://david-dm.org/npeter/iobroker.apsystems-ecu)
[![Known Vulnerabilities](https://snyk.io/test/github/npeter/ioBroker.apsystems-ecu/badge.svg)](https://snyk.io/test/github/npeter/ioBroker.apsystems-ecu)

[![NPM](https://nodei.co/npm/iobroker.apsystems-ecu.png?downloads=true)](https://nodei.co/npm/iobroker.apsystems-ecu/)

## Integration of APSystems inverters via ECU-R 
This adapter integrates [APSystems](https://apsystems.com/) inverters via APSystems ECU-R communication unit. 
The adapter queries the local ECU-R using the proprietary APSytems ECU to EMAapp protocol. It collects realtime information and history data from the unit about the connected (via zigbee) inverters and the ECU itself.
<br>
<br>
## Many Thanks ...
This project was only possible because of the great protocol analysis work of @checking12, @HAEdwin and other people on the home assistant forum. 
<br>
There exists also already a Python implementation for home assistant 
[ksheumaker/homeassistant-apsystems_ecur](https://github.com/ksheumaker/homeassistant-apsystems_ecur) which was used to get a better understanding of the  of the ECU behavior. 
<br>
<br>
## How it works todo
- ECU verbindung zur EMA cloude
- Locale communcation über TCP port 8899
- Cloude fake 
- ECU to Inverter Intervall 300sec
## Suported devices and functions 

Communication units:
- ECU-R - tested
- ECU-C - may work but not tested
- ECU-B (not clear)

Inverters:
- QS1 - single device tested
- YC600 - not tested
- YC1000 - not tested

ECU services:
- GetSystemInfo
- GetRealTimeData
- GetPowerOfDay
- GetEnergyOfWeekMonthYear
- GetInverterSignalLevel





## ToDo


![Adapter Request](https://github.com/ioBroker/AdapterRequests/issues/645)

Adapter Request
https://github.com/ioBroker/AdapterRequests/issues/645


https://community.home-assistant.io/t/apsystems-aps-ecu-r-local-inverters-data-pull/260835/141

Weblinks

[Extracting data from APSystems inverters via EMAcloud](https://medium.com/@rukmalf/extracting-data-from-apsystems-inverters-8c2b8e8942b6)



## Changelog

### 0.0.1
* (npeter) initial release

## License
MIT License

Copyright (c) 2021 npeter <peter_n@gmx.de>

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