const definition = require("./definition.js")
const App = require("@live-change/framework")
const { PropertyDefinition, ViewDefinition, IndexDefinition, ActionDefinition, EventDefinition } = App
const { Session } = require("./model.js")

definition.processor(function(service, app) {

  for(let modelName in service.models) {
    const model = service.models[modelName]

    if(model.sessionProperty) {
      console.log("MODEL " + modelName + " IS SESSION PROPERTY, CONFIG:", model.sessionProperty)
      if (model.properties.session) throw new Error('session property already exists!!!')

      const originalModelProperties = {...model.properties}
      const modelProperties = Object.keys(model.properties)
      const defaults = App.utils.generateDefault(model.properties)

      function modelRuntime() {
        return service._runtime.models[modelName]
      }

      const config = model.sessionProperty
      const writeableProperties = modelProperties || config.writableProperties

      model.propertyOf = {
        what: Session,
        ...config
      }

      if(config.sessionReadAccess) {
        const viewName = 'mySession' + modelName
        service.views[viewName] = new ViewDefinition({
          name: viewName,
          access: config.sessionReadAccess,
          daoPath(params, { client, context }) {
            return modelRuntime().path(client.session)
            //return modelRuntime().indexObjectPath('bySession', client.session)
          }
        })
      }

      if(config.sessionSetAccess || config.sessionWriteAccess) {
        const eventName = 'sessionOwned' + modelName + 'Set'
        const actionName = 'setMySession' + modelName
        service.actions[actionName] = new ActionDefinition({
          name: actionName,
          properties: {
            ...originalModelProperties
          },
          access: config.sessionSetAccess || config.sessionWriteAccess,
          skipValidation: true,
          queuedBy: (command) => command.client.session,
          waitForEvents: true,
          async execute(properties, {client, service}, emit) {
            let newObject = {}
            for(const propertyName of writeableProperties) {
              if(properties.hasOwnProperty(propertyName)) {
                newObject[propertyName] = properties[propertyName]
              }
            }
            const data = App.utils.mergeDeep({}, defaults, newObject)
            await App.validation.validate(data, validators, { source: action, action, service, app, client })
            emit({
              type: eventName,
              identifiers: {
                session: client.session
              },
              data
            })
          }
        })
        const action = service.actions[actionName]
        const validators = App.validation.getValidators(action, service, action)
      }

      if(config.sessionUpdateAccess || config.sessionWriteAccess) {
        const eventName = 'sessionOwned' + modelName + 'Updated'
        const actionName = 'updateMySession' + modelName
        service.actions[actionName] = new ActionDefinition({
          name: actionName,
          properties: {
            ...originalModelProperties
          },
          access: config.sessionUpdateAccess || config.sessionWriteAccess,
          skipValidation: true,
          queuedBy: (command) => command.client.session,
          waitForEvents: true,
          async execute(properties, { client, service }, emit) {
            const entity = await modelRuntime().get(client.session)
            if(!entity) throw 'not_found'
            let updateObject = {}
            for(const propertyName of writeableProperties) {
              if(properties.hasOwnProperty(propertyName)) {
                updateObject[propertyName] = properties[propertyName]
              }
            }
            const merged = App.utils.mergeDeep({}, entity, updateObject)
            await App.validation.validate(merged, validators, { source: action, action, service, app, client })
            emit({
              type: eventName,
              identifiers: {
                session: client.session
              },
              data: properties || {}
            })
          }
        })
        const action = service.actions[actionName]
        const validators = App.validation.getValidators(action, service, action)
      }

      if(config.sessionResetAccess || config.sessionWriteAccess) {
        const eventName = 'sessionOwned' + modelName + 'Reset'
        const actionName = 'resetMySession' + modelName
        service.actions[actionName] = new ActionDefinition({
          name: actionName,
          access: config.sessionResetAccess || config.sessionWriteAccess,
          queuedBy: (command) => command.client.session,
          waitForEvents: true,
          async execute(properties, {client, service}, emit) {
            const entity = await modelRuntime().indexObjectGet('bySession', client.session)
            if (!entity) throw 'not_found'
            emit({
              type: eventName,
              identifiers: {
                session: client.session
              }
            })
          }
        })
      }

    }
  }

})