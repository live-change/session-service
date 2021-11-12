const App = require("@live-change/framework")
const app = App.app()
const definition = require('./definition.js')
const Session = require('./model.js')


const User = definition.foreignModel('user', 'User')


definition.view({
  name: 'currentSession',
  properties: {},
  returns: {
    type: Session
  },
  daoPath(params, { client, context }) {
    //return Session.path(client.session)
    console.log("CURRENT SESSION(", client.session)
    return ['database', 'queryObject', app.databaseName, `(${
      async (input, output, { session, tableName }) => {
        const mapper = (obj) => (obj || {
          id: session,
          user: null,
          roles: []
        })
        let storedObj = undefined
        await input.table(tableName).object(session).onChange(async (obj, oldObj) => {
          const mappedObj = mapper(obj)
          //output.debug("MAPPED DATA", session, "OBJ", mappedObj, "OLD OBJ", storedObj)
          await output.change(mappedObj, storedObj)
          storedObj = mappedObj
        })
      }
    })`, { session: client.session, tableName: Session.tableName }]
  }
})

definition.trigger({
  name: "createSessionIfNotExists",
  properties: {
    session: {
      type: String,
      validation: ['nonEmpty']
    }
  },
  waitForEvents: true,
  async execute({ session }, context, emit) {
    if(!session) session = client.session
    if(session != client.session) throw new Error("Wrong session id")
    const currentSession = await Session.get(session)
    if(currentSession) return 'exists'
    console.log("CREATE SESSION!", session, "AT", (new Date()).toISOString())
    emit({
      type: "created",
      session
    })
    return 'created'
  }
})

definition.trigger({
  name: "createSessionKeyIfNotExists",
  properties: {
    sessionKey: {
      type: String,
      validation: ['nonEmpty']
    }
  },
  waitForEvents: true,
  async execute({ sessionKey }, context, emit) {
    const currentSession = await Session.indexObjectGet("byKey", sessionKey)
    if(currentSession) return { type: 'exists', session: currentSession.id }
    const session = app.generateUid()
    console.log("CREATE SESSION!", session, "AT", (new Date()).toISOString())
    emit({
      type: "created",
      session,
      key: sessionKey
    })
    return { type: 'created', session }
  }
})

definition.action({
  name: "logout",
  properties: {
  },
  async execute({ session }, { client, service }, emit) {
    if(!session) session = client.session
    if(session != client.session) throw new Error("Wrong session id")
    const sessionRow = await Session.get(session)
    if(!sessionRow) throw 'notFound'
    if(!sessionRow.user) throw "loggedOut"
    emit({
      type: "loggedOut",
      session
    })
    await service.trigger({
      type: "OnLogout",
      user: sessionRow.user,
      session: client.session
    })
    return 'loggedOut'
  }
})

definition.trigger({
  name: "UserDeleted",
  properties: {
    user: {
      type: User,
      idOnly: true
    }
  },
  async execute({ user }, context, emit) {
    emit([{
      type: "UserDeleted",
      user
    }])
  }
})


require('./authenticator.js')
require('./localIdValidator.js')
require('./sessionProperty.js')
require('./sessionItem.js')


module.exports = definition
