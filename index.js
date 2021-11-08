const App = require("@live-change/framework")
const app = App.app()
const { createHmac } = require('crypto')

const definition = app.createServiceDefinition({
  name: "session"
})

const User = definition.foreignModel('user', 'User')

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
              { op: 'reverseMerge', value: { id: ind.to } },
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
      session = createHmac('sha256', config.sessionHmacSecret || 'secret')
        .update(credentials.sessionKey)
        .digest('base64')
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

const { PropertyDefinition, ViewDefinition, IndexDefinition, ActionDefinition } = require("@live-change/framework")

definition.processor(function(service, app) {
  for(let modelName in service.models) {
    const model = service.models[modelName]
    console.trace("PROCESS MODEL "+modelName)
    if(model.properties.session) throw new Error('session property already exists!!!')
    const originalModelProperties = { ...model.properties }
    const modelProperties = Object.keys(model.properties)
    const modelPropertyName = modelName.slice(0, 1).toLowerCase() + modelName.slice(1)
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
      if(config.setAccess || config.writeAccess) {
        const actionName = 'setSession' + modelName
        service.actions[actionName] = new ActionDefinition({
          name: actionName,
          access: config.createAccess || config.writeAccess,
          async execute(properties, { client, service }, emit) {
            const id = client.session
            return await modelRuntime().create({ ...properties, id, session: client.session })
          }
        })
      }
      if(config.resetAccess || config.writeAccess) {
        const actionName = 'resetSession' + modelName
        service.actions[actionName] = new ActionDefinition({
          name: actionName,
          access: config.createAccess || config.writeAccess,
          async execute(properties, { client, service }, emit) {
            const entity = await modelRuntime().indexObjectGet('bySession', client.session)
            if(!entity) throw new Error('not_found')
            await modelRuntime().delete(entity.id)
          }
        })
      }
    }
    if(model.sessionItem) {
      const config = model.sessionItem
      const writeableProperties = modelProperties || config.writableProperties

      console.log("SESSIONM ITEM", model)

      model.properties.session = new PropertyDefinition({
        type: Session,
        validation: ['nonEmpty']
      })
      if(!model.indexes) model.indexes = {}
      model.indexes.bySession = new IndexDefinition({
        property: 'session'
      })
      for(const sortField of config.sortBy) {
        const sortFieldUc = sortField.slice(0, 1).toUpperCase() + sortField.slice(1)
        model.indexes['bySession' + sortFieldUc] = new IndexDefinition({
          property: ['session', sortField]
        })
      }

      if(config.readAccess) {
        const viewName = 'session' + modelName + 's'
        service.views[viewName] = new ViewDefinition({
          name: viewName,
          access: config.readAccess,
          properties: App.rangeProperties,
          daoPath(range, { client, context }) {
            return modelRuntime().sortedIndexRangePath('bySession', [client.session], range )
          }
        })
        for(const sortField of config.sortBy) {
          const sortFieldUc = sortField.slice(0, 1).toUpperCase() + sortField.slice(1)
          const viewName = 'session' + modelName + 'sBy' + sortFieldUc
          service.views[viewName] = new ViewDefinition({
            name: viewName,
            access: config.readAccess,
            properties: App.rangeProperties,
            daoPath(range, { client, context }) {
              return modelRuntime().sortedIndexRangePath('bySession' + sortFieldUc, [client.session], range )
            }
          })
        }
      }
      if(config.publicAccess) {
        const viewName = 'publicSession' + modelName + 's'
        service.views[viewName] = new ViewDefinition({
          name: viewName,
          access: config.publicAccess,
          properties: App.rangeProperties,
          daoPath(range, { client, context }) {
            return modelRuntime().sortedIndexRangePath('bySession', [range.session], { ...range, session: undefined } )
          }
        })
        for(const sorfField of config.sortBy) {
          const sortFieldUc = sorfField.slice(0, 1).toUpperCase() + sortField.slice(1)
          const viewName = 'publicSession' + modelName + 'sBy' + sortFieldUc
          service.views[viewName] = new ViewDefinition({
            name: viewName,
            access: config.publicAccess,
            properties: App.rangeProperties,
            daoPath(range, { client, context }) {
              return modelRuntime().sortedIndexRangePath('bySession' + sortFieldUc, [client.session], range )
            }
          })
        }
      }
      if(config.createAccess || config.writeAccess) {
        const actionName = 'createSession' + modelName
        console.log("OP", Object.keys(originalModelProperties))
        service.actions[actionName] = new ActionDefinition({
          name: actionName,
          access: config.createAccess || config.writeAccess,
          properties: {
            ...originalModelProperties
          },
          async execute(properties, { client, service }, emit) {
            const id = app.generateUid()
            await modelRuntime().create({ ...properties, id, session: client.session })
            return id
          }
        })
      }
      if(config.updateAccess || config.writeAccess) {
        const actionName = 'updateSession' + modelName
        service.actions[actionName] = new ActionDefinition({
          name: actionName,
          access: config.updateAccess || config.writeAccess,
          properties: {
            ...originalModelProperties,
            [modelPropertyName]: {
              type: model,
              validation: ['nonEmpty']
            }
          },
          async execute(properties, { client, service }, emit) {
            const entity = await modelRuntime().get(properties[modelPropertyName])
            if(!entity) throw new Error('not_found')
            if(entity.session != client.session) throw new Error('not_authorized')
            let updateObject = {}
            for(const propertyName of writeableProperties) {
              updateObject[propertyName] = properties[propertyName]
            }
            return await modelRuntime().update(entity.id, updateObject)
          }
        })
      }
      if(config.deleteAccess || config.writeAccess) {
        const actionName = 'deleteSession' + modelName
        service.actions[actionName] = new ActionDefinition({
          name: actionName,
          access: config.createAccess || config.writeAccess,
          properties: {
            [modelPropertyName]: {
              type: model,
              validation: ['nonEmpty']
            }
          },
          async execute(properties, { client, service }, emit) {
            const entity = await modelRuntime().get(properties[modelPropertyName])
            if(!entity) throw new Error('not_found')
            if(entity.session != client.session) throw new Error('not_authorized')
            await modelRuntime().delete(entity.id)
          }
        })
      }
    }
  }
})

module.exports = definition
