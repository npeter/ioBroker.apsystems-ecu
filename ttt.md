![Logo](admin/apsystems-ecu.png)
# ioBroker.apsystems-ecu

## Integrate APSystems inverters via ECU-R 
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

