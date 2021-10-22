

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
  itst();