const definition = require("./definition.js")
const { decodeUid } = require("@live-change/uid")

definition.processor(function(service, app) {

  service.validators.localId = (settings) => (value, context) => {
    if (!value) return
    //console.log("VALIDATE LOCAL ID", value, "=>", decodeUid(value), "BY", context.client)
    const {date, number, at} = decodeUid(value)
    if (at.length < 16) return "tooShortSessionFingerprint"
    if (context.client.session && at == context.client.session.slice(0, at.length)) return
    if (context.client.user && at == context.client.user.slice(0, at.length)) return
    return "sessionFingerPrintMismatch"
  }

})