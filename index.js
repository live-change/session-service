const app = require("@live-change/framework").app()

const definition = app.createServiceDefinition({
  name: "session"
})

const User = definition.foreignModel('users', 'User')

const Session = definition.model({
  name: "Session",
  properties: {
    key: {
      type: String
    },
    user: {
      type: User
    },
    roles: {
      type: Array,
      of: {
        type: String
      }
    }
  },
  indexes: {
    byKey: {
      property: 'key'
    },
    byUser: {
      property: "user"
    }
  }
})

definition.view({
  name: 'currentSession',
  properties: {},
  returns: {
    type: Session
  },
  daoPath(params, { client, context }, method) {
    //return Session.path(client.session)
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
    })`, { session: client.sessionId, tableName: Session.tableName }]
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

definition.event({
  name: "created",
  properties: {
    session: {
      type: Session
    },
    key: {
      type: String
    }
  },
  async execute({ session, key }) {
    console.log("SESSION CREATING!", session, "AT", (new Date()).toISOString())
    await Session.create({
      id: session,
      key: key,
      user: null,
      roles: []
    })
    console.log("SESSION CREATED!", session, "AT", (new Date()).toISOString())
  }
})

definition.event({
  name: "loggedIn",
  properties: {
    session: {
      type: Session
    },
    user: {
      type: User
    },
    roles: {
      type: Array,
      of: {
        type: String
      }
    },
    expire: {
      type: Date
    }
  },
  async execute({ session, user, roles, expire, language, timezone }) {
    console.log("SESSION UPDATE", session, { user, roles, expire, language, timezone })
    await Session.update(session, { user, roles, expire, language, timezone })
  }
})

definition.event({
  name: "loggedOut",
  properties: {
    session: {
      type: Session
    }
  },
  async execute({ session }) {
    await Session.update(session, [
      { op: 'reverseMerge', value: { id: session } },
      { op: 'merge', value: { user: null, roles: [] } }
    ])
  }
})

definition.event({
  name: "UserDeleted",
  properties: {
    user: {
      type: User
    }
  },
  async execute({ user }) {
    await app.dao.request(['database', 'query'], app.databaseName, `(${
      async (input, output, { table, index, user }) => {
        const prefix = `"${user}"_`
        await (await input.index(index)).range({
          gte: prefix,
          lte: prefix+"\xFF\xFF\xFF\xFF"
        }).onChange((ind, oldInd) => {
          if(ind && ind.to) {
            output.table(table).update(ind.to, [
              { op: 'reverseMerge', value: { id: session } },
              { op: 'merge', value: { user: null, roles: [], expire: null } }
            ])
          }
        })
      }
    })`, { table: Session.tableName, index: Session.tableName + '_byUser', user })
  }
})

definition.event({
  name: "rolesUpdated",
  properties: {
    user: {
      type: User
    },
    roles: {
      type: Array,
      of: {
        type: String
      }
    }
  },
  async execute({ user, roles }) {
    await app.dao.request(['database', 'query'], app.databaseName, `(${
        async (input, output, { table, index, user, roles }) => {
          const prefix = `"${user}"_`
          await (await input.index(index)).range({
            gte: prefix,
            lte: prefix+"\xFF\xFF\xFF\xFF"
          }).onChange((ind, oldInd) => {
            if(ind && ind.to) {
              output.table(table).update(ind.to, [
                { op: 'reverseMerge', value: { id: session } },
                { op: 'merge', value: { roles } }
              ])
            }
          })
        }
    })`, { table: Session.tableName, index: Session.tableName + '_byUser', user, roles })
  }
})

definition.authenticator(async function(credentials, config) {
  const sessionKey = credentials.sessionKey
  if(!sessionKey) throw new Error("sessionKey required!")
  const sessions = await app.dao.get(
    ['database', 'indexRange', app.databaseName, Session.tableName + '_byKey', {
      gt: `"${sessionKey}"_`,
      lt: `"${sessionKey}"_\xFF`
    }])
  console.log("FOUND SESSIONS", sessions)
  let session = sessions[0]?.to
  if(!session) {
    if(config.createSessionOnUpdate) {
      session = app.generateUid()
    } else {
      const createResult = await app.triggerService(definition.name, {
        type: "createSessionKeyIfNotExists",
        sessionKey
      })
      console.log("CREATE SESSION RESULT", createResult)  
      session = createResult.session
    } 
  }
  credentials.session = session
})

const { PropertyDefinition, ViewDefinition, IndexDefinition } = require("@live-change/framework")

definition.processor(function(service, app) {
  for(let modelName in service.models) {    
    const model = service.models[modelName]
    function modelRuntime() {
      return service._runtime.models[modelName]
    }
    if(model.sessionProperty) {
      const config = model.sessionProperty
      model.properties.session = new PropertyDefinition({
        type: Session,
        validation: ['nonEmpty']
      })
      if(!model.indexes) model.indexes = {}
      model.indexes.bySession = new IndexDefinition({
        property: 'session'
      })
      if(config.readAccess) {
        const viewName = 'session' + modelName
        service.views[viewName] = new ViewDefinition({
          name: viewName,
          access: config.readAccess,
          daoPath(params, { client, context }) {
            return modelRuntime().indexObjectPath('bySession', client.session)
          }
        })
      }
      if(config.publicAccess) {
        const viewName = 'publicSession' + modelName
        service.views[viewName] = new ViewDefinition({
          name: viewName,
          access: config.publicAccess,
          daoPath({ session }, { client, context }) {
            return modelRuntime().indexObjectPath('bySession', session)
          }
        })
      }
      if(config.writeAccess) {

      }
    }
  }
})

module.exports = definition
