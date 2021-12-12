const App = require('@live-change/framework')
const app = App.app()
const definition = require('./definition.js')
const { Session } = require('./model.js')
const { createHmac } = require('crypto')
const config = definition.config

definition.authenticator({
  async prepareCredentials(credentials) {
    const sessionKey = credentials.sessionKey
    if(!sessionKey) throw new Error("sessionKey required!")
    const sessions = await app.dao.get(
        ['database', 'indexRange', app.databaseName, Session.tableName + '_byKey', {
          gt: `"${sessionKey}"_`,
          lt: `"${sessionKey}"_\xFF`
        }])
    //console.log("FOUND SESSIONS", sessions)
    let session = sessions[0]?.to
    if(!session) {
      if(config.createSessionOnUpdate) {
        session = createHmac('sha256', config.sessionHmacSecret || 'secret')
            .update(credentials.sessionKey)
            .digest('base64').slice(0, 32)
      } else {
        const createResult = await app.triggerService(definition.name, {
          type: "createSessionKeyIfNotExists",
          sessionKey
        })
        //console.log("CREATE SESSION RESULT", createResult)
        session = createResult.session
      }
    }
    credentials.session = session
  }
})
