// json
const bodyParser = require('body-parser');

// postgres
const {Client} = require('pg');
const client = new Client();

// database update loop
while (true) {
    // get gpulist
    const gpuList = [].replace(' ', '+'); // replace spaces with + to be suitable for url request format

    // mark all existing listings as "unavailable"
    // clients will also use environment variables
    // for connection information
    await client.connect()
    const res = await client.query('UPDATE gpudb SET available = FALSE')
    await client.end()

    // localisation tbd
    const COUNTRY = AU;
    const CURRENCY = AUD;

    // search for each gpu
    for (const gpu of gpuList) { // TODO create async tasks, start all together and wait for completion
        // make request to ebay api
        // Create WebSocket connection.
        const url = ['https://svcs.ebay.com/services/search/FindingService/v1?',
        'OPERATION-NAME=findItemsAdvanced&',
        'SERVICE-VERSION=1.13.0&',
        'SECURITY-APPNAME=',
        process.env('EBAY_API_KEY'),
        '&',
        'RESPONSE-DATA-FORMAT=JSON&',
        'REST-PAYLOAD=true&',
        'GLOBAL-ID=EBAY-' + COUNTRY + '&',
        'affiliate.networkId=9&', // SHOULD BE VARIABLE
        'affiliate.trackingId=5338664158&', // SHOULD BE VARIABLE
        // ITEM FILTERS
        // additional item filters can be found at https://developer.ebay.com/devzone/finding/callref/types/ItemFilterType.html
        'itemFilter(0).name=Condition&',
        'itemFilter(0).value(0)=3000&', // Used
        'itemFilter(0).value(1)=1000&', // New
        'itemFilter(0).value(2)=1500&', // New (other, see item details
        'itemFilter(0).value(3)=2000&', // Manufacturer refurbished
        'itemFilter(0).value(4)=4000&', // Very good
        'itemFilter(0).value(5)=5000&', // Good
        'itemFilter(0).value(6)=6000&', // Acceptable
        'itemFilter(1).name=ListingType&',
        'itemFilter(1).value(0)=FixedPrice&',
        'itemFilter(1).value(1)=AuctionWithBIN&',
        'itemFilter(1).value(2)=StoreInventory&',
        'itemFilter(2).name=LocalPickupOnly&',
        'itemFilter(2).value=false&',
        'itemFilter(3).name=Currency&',
        'itemFilter(3).value=' + CURRENCY + '&', // LOCALISATION TARGET
        'itemFilter(4).name=LocatedIn&',
        'itemFilter(4).value=' + COUNTRY + '&', // LOCALISATION TARGET
        'keywords=',
        gpu, // The gpu  being searched for
        '+-cooler+-performance+-like+-backplate+-waterblock+-buying+-bracket+-fan+-fans+-replacement+-mosfet+-powerlink+-bios+-nvlink+-kit+-suits+-faulty+-1080p+-description&', // Blacklisted terms
        'LH_PrefLoc=1&', // Only show items within region selected
        'categoryId=27386&',
        'paginationInput.entriesPerPage=100&', // redundent?
        'sortOrder=PricePlusShippingLowest'].join();
        const socket = new WebSocket(url);

        // Listen for messages asynchronously
        socket.addEventListener('message', function(event) {
            // interpret returned JSON
            const req = event.data;
            if (gpu.data.findItemsAdvancedResponse[0].searchResult[0]['@count'] > 0){
                for (let i of gpu.data.findItemsAdvancedResponse[0].searchResult[0].item){
                    // price = price + shipping cost
                    // shipping price cannot be determined if calculated method is used
                    let price;
                    if (i.shippingInfo[0].shippingServiceCost){
                        price = i.sellingStatus[0].currentPrice[0].__value__ + i.shippingInfo[0].shippingServiceCost[0].__value__;
                    }
                    else {
                        price = i.sellingStatus[0].currentPrice[0].__value__;
                    }

                    // push data to postgres db
                    // clients will also use environment variables
                    // for connection information
                    await client.connect()
                    const res = await client.query('IF \
                    (EXISTS\
                    (SELECT * FROM gpudb WHERE gpu = ' + gpu + ' AND title = ' + i.title +' AND itemurl = ' + i.viewItemURL + ' AND imageurl = ' + i.galleryURL + ' AND price = ' + price + '))\
                    BEGIN \
                    UPDATE gpudb SET available TRUE WHERE WHERE gpu = ' + gpu + ' AND title = ' + i.title +' AND itemurl = ' + i.viewItemURL + ' AND imageurl = ' + i.galleryURL + ' AND price = ' + price + '\
                    END \
                    ELSE \
                    BEGIN \
                    INSERT INTO gpudb (gpu, title, itemurl, imageurl, price, currency, available) VALUES (' + gpu + ', ' + i.title + ', ' + i.viewItemURL + ', ' + i.galleryURL + ', ' + price + ', ' + CURRENCY + ', TRUE)\
                    END')
                    await client.end()
                }
            }
        });
    }

    // remove all listings found to now be "unavailable"
    // clients will also use environment variables
    // for connection information
    await client.connect()
    const res = await client.query('DELETE FROM gpudb \
    WHERE (available, FALSE) IN \
    ( SELECT available, FALSE FROM gpudb )')
    await client.end()
}