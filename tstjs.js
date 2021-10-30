const SunCalc = require('suncalc2');
const schedule = require('node-schedule');




/*
  let day1 = new Date();
  console.log(day1);
  let day2 = new Date().toISOString();
  console.log(day2);

  let day3 = day2.substring(0,4) + day2.substring(5,7) + day2.substring(8,10);
  console.log(day3);
*/
/*
    let day = null;
    if ( day == null) {
        let todayISO = new Date().toISOString();
        day = todayISO.substring(0,4) + todayISO.substring(5,7) + todayISO.substring(8,10);
        console.log(todayISO);
        console.log(day);   
    }
*/

    function suncalc() {
        let times = SunCalc.getTimes(new Date(), 49.8648048, 9.601144);
        let sunRise = times.sunrise;
        let sunSet = times.sunset;
        console.log(`sunRise: ${sunRise}`);
        console.log(`sunSet: ${sunSet}`);
    }
    
//suncalc();
    
let astroTime = SunCalc.getTimes(new Date(), 49.8648048, 9.601144);
let sunRise = astroTime.sunrise;
let sunSet = astroTime.sunset;
console.log(`sunRise: ${sunRise}`);
console.log(`sunSet: ${sunSet}`);
console.log(typeof sunRise);
console.log(typeof astroTime.sunrise);
console.log(Object.keys(astroTime));
console.log(Object.values(astroTime));

let sunSetHoursStr = ('0' + astroTime.sunset.getHours()).slice(-2);
let sunSetMinutesStr = ('0' + astroTime.sunset.getMinutes()).slice(-2);

console.log(sunSetHoursStr);
console.log(sunSetMinutesStr);
let sunSetLiteral = {};
sunSetLiteral['hour'] = astroTime.sunset.getHours();
sunSetLiteral['minute'] = astroTime.sunset.getMinutes();

let now = new Date();
let nowObject = {};
nowObject['hour'] = now.getHours() - (now.getTimezoneOffset()/60);
nowObject['minutes'] = now.getMinutes() + 1;

console.log(`now.getTimezoneOffset(): ${now.getTimezoneOffset()}`);
console.log(nowObject);

console.log(JSON.stringify(nowObject));

const job = schedule.scheduleJob(nowObject, () => {
    console.log('hello peter');
})
/*
const startSchedule = schedule.scheduleJob(sunRise, () => {
    console.log(`jobStart at {jobStart}`)
});

let _sunRise = new Date(astroTime.sunrise);
console.log(_sunRise);

/*
const jobStart = {
    if (jobStart) {
        // jobStart.cancel();
        jobStart.reschedule(sunRise, () => {
            console.log(`jobStart at {jobStart}`)
        })
    } else {
        jobStart.scheduleJob(sunRise, () => {
            console.log(`jobStart at {jobStart}`)
        })        
    }

}
  
const jobEnd = schedule.scheduleJob(_sunRise, () => {
    console.log(`jobEnd at {jobEnd}`)
});
console.log.toString(jobEnd);
//jobStart();
//jobEnd();
 */