

function f1() {
    return new Promise( resolve => {
        setTimeout( () => {
            console.log('f1');
            resolve('f1');
        }, 2000);
    });
}

function f2() {
    return new Promise( resolve => {
        setTimeout( () => {
            console.log('f2');
            resolve('f2');
        }, 1000);
    });
}


async function f1f2() {

    const resultF1 = await f1();
    const resultF2 = await f2();
}


function itst() {
    setInterval( () => {
        console.log('interval');
        f1f2(); 

    }, 5000);
    console.log('itst');
}



  //f1f2();
  //itst();

/*
  let day1 = new Date();
  console.log(day1);
  let day2 = new Date().toISOString();
  console.log(day2);

  let day3 = day2.substring(0,4) + day2.substring(5,7) + day2.substring(8,10);
  console.log(day3);
*/
    let day = null;
    if ( day == null) {
        let todayISO = new Date().toISOString();
        day = todayISO.substring(0,4) + todayISO.substring(5,7) + todayISO.substring(8,10);
        console.log(todayISO);
        console.log(day);   
    }

    
  