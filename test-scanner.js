const { parseScanInput } = require('./frontend/src/services/scannerParser.js');
const rawValue = "41/6:XOB|21:YTQ|2604318619077:RAB|82INEG:UKS|6014062-ODNIRAMAT:TOL";
console.log(parseScanInput(rawValue));
