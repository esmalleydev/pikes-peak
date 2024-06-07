import fs from 'fs';
const dataLocation = './data.json';
const map = JSON.parse(fs.readFileSync(dataLocation, 'utf8'));

const apiKey = '330cf90844f696804c5371811d0de097375c9e9a45eff4685ae66224125552a19c0c31cd36c95b15328702f0e0812cd2a71be477f17ef1f3a7020336301df9e4d4c57431d677b1bf06b15d13b5db952f8ca8a93aef15aa0c95548d9c620da95553cc9019b703c7e84e4b6da7981427';

const run = false;
let running = false;

async function fetcher(url) {
  return fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
  }).then(response => {
    return response.json();
  }).then(json => {
    // console.log(json);
    return json;
  }).catch(error => {
    console.log(error);
  });
};

async function getOrders() {
  const baseUrl = 'https://api.humanitix.com/v1/events/6542a779d1f223719b9ae6aa/orders?';
  const initalData = await fetcher(baseUrl + 'page=1');

  let orders = [];

  if (
    initalData &&
    initalData.total &&
    initalData.page &&
    initalData.pageSize
  ) {
    const total = initalData.total;
    const pages = Math.round(initalData.total / initalData.pageSize);

    orders = initalData.orders;

    for (let i = 1; i < pages; i++) {
      const data = await fetcher(baseUrl + 'page=' + (i + 1));

      if (data && data.orders) {
        orders = orders.concat(data.orders);
      } else {
        console.log(data);
        console.error('missing orders?')
      }
    }

    // console.log(orders);

    if (orders.length !== total) {
      console.log('order length does not equal total');
      return;
    }

    return orders;
  } else {
    console.log('?')
    // console.log(initalData);
  }
};


/**
 * Send to SpeedWaiver
 * @param {object} data
 * @param {string} data.id
 * @param {string} data.number
 * @param {string} data.family_name
 * @param {string} data.given_name
 * @param {string} data.event_id
 * @param {string} data.orderName
 */
async function sendSpeedWaiver(data) {
  const args = {
    'family_name': data.family_name,
    'given_name': data.given_name,
    'event_id': data.event_id,
    'send_notification_via': 'sms',
    'sms_number': data.number,
    'meta': {'qrCodeId': data.orderName},
  };
  // console.log(args);
  if (!run) {
    return;
  }

  return fetch('https://api.speedwaiver.com/api/v1/waiver_invitations', {
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': '0974dac7-322b-4b97-a71c-a01a4de8c4a9'
    },
    body: JSON.stringify(args)
  }).then(response => {
    map[data.id] = true;
    fs.writeFileSync(dataLocation, JSON.stringify(map));
  }).catch(error => {
    console.error(error);
  });
};

function extractAndFormatPhoneNumbers(text) {
  // Regular expression to match phone numbers
  const phoneRegex = /(\+1\s*)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
  
  // Find all potential phone numbers in the text
  const matches = text.match(phoneRegex);
  
  if (!matches) {
    return []; // No phone numbers found
  }

  const formattedNumbers = matches.map(number => {
    // Remove any non-digit characters
    let digits = number.replace(/\D/g, '');

    // Check for valid number length (assuming 10 digits for US numbers)
    if (digits.length === 10) {
      // Prepend the country code +1 for US
      return `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      // If it starts with '1' and has 11 digits, it's already in the correct format
      return `+${digits}`;
    } else {
      // Invalid number
      return null;
    }
  });

  // Filter out any null values which represent invalid phone numbers
  return formattedNumbers.filter(number => number !== null);
}

async function app() {
  if (running === true) {
    console.log('already running');
    return;
  }
  console.log('running');
  running = true;
  const orders = await getOrders();

  const questionId = '654a81d410777575d525c4f4';

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];

    // do not run if already ran
    if (order._id in map) {
      continue;
    }

    let mobileNumbers = null;
    let mobileNumber = null;
    let orderMobileNumber = (
      order.mobile &&
      (mobileNumbers = extractAndFormatPhoneNumbers(order.mobile)) &&
      mobileNumbers.length &&
      mobileNumbers.length === 1 &&
      (mobileNumber = mobileNumbers[0])
    ) || null;

    let mobileInOrder = false;

    if (order.additionalFields && order.additionalFields.length) {
      const questions = order.additionalFields;
      for (let q = 0; q < questions.length; q++) {
        const question = questions[q];
        if (
          question.questionId === questionId &&
          question.value &&
          question.value.length
        ) {
          const numbers = extractAndFormatPhoneNumbers(question.value);

          // console.log(question.value)
          // console.log(numbers);

          for (let n = 0; n < numbers.length; n++) {
            if (numbers[n] === orderMobileNumber) {
              mobileInOrder = true;
            }
            await sendSpeedWaiver({
              'id': order._id,
              'number': numbers[n],
              'family_name': order.lastName,
              'given_name': order.firstName,
              'orderName': order.orderName,
              'event_id': order.eventId,
            });
          }
        }
      }
    }

    if (orderMobileNumber && !mobileInOrder) {
      await sendSpeedWaiver({
        'id': order._id,
        'number': orderMobileNumber,
        'family_name': order.lastName,
        'given_name': order.firstName,
        'orderName': order.orderName,
        'event_id': order.eventId,
      });
    }
  }
  console.log('finished');
  running = false;
};

// run on start up
app();

// run every 10 mins
setInterval(app, 10 * 60 * 1000);