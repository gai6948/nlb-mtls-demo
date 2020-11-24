exports.handler = function handler(event: any, context: any, callback: any) {

  const respBody = {
    message: "Hello from private lambda"
  }

  const response = {
    "statusCode": 200,
    "headers": {
      "source": "lambda",
    },
    "body": JSON.stringify(respBody),
    "isBase64Encoded": false
  }
  callback(null, response);
};
