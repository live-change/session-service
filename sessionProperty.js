const definition = require("./definition.js")
const App = require("@live-change/framework")
const { PropertyDefinition, ViewDefinition, IndexDefinition, ActionDefinition, EventDefinition } = App
const Session = require("./model.js")

definition.processor(function(service, app) {

  for(let modelName in service.models) {
    const model = service.models[modelName]

    if(model.sessionProperty) {
      console.trace("PROCESS MODEL " + modelName)
      if (model.properties.session) throw new Error('session property already exists!!!')
      const originalModelProperties = {...model.properties}
      const modelProperties = Object.keys(model.properties)
      const defaults = App.utils.generateDefault(modelProperties)
      const modelPropertyName = modelName.slice(0, 1).toLowerCase() + modelName.slice(1)

      function modelRuntime() {
        return service._runtime.models[modelName]
      }

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
          daoPath(params, {client, context}) {
            return modelRuntime().indexObjectPath('bySession', client.session)
          }
        })
      }
      if(config.publicAccess) {
        const viewName = 'publicSession' + modelName
        service.views[viewName] = new ViewDefinition({
          name: viewName,
          access: config.publicAccess,
          daoPath({session}, {client, context}) {
            return modelRuntime().indexObjectPath('bySession', session)
          }
        })
      }

      if(config.setAccess || config.writeAccess) {
        const eventName = 'session' + modelName + 'Set'
        service.events[eventName] = new EventDefinition({
          name: eventName,
          properties: {
            ...originalModelProperties
          },
          execute(properties) {
            const data = properties.data
            const session = properties.session
            return modelRuntime().create({...data, session, id: session})
          }
        })
        const actionName = 'setSession' + modelName
        service.actions[actionName] = new ActionDefinition({
          name: actionName,
          access: config.createAccess || config.writeAccess,
          queuedBy: (command) => command.client.session,
          waitForEvents: true,
          async execute(properties, {client, service}, emit) {
            emit({
              type: eventName,
              session: client.session,
              data: properties || {}
            })
          }
        })
      }
      if(config.updateAccess || config.writeAccess) {
        const eventName = 'session' + modelName + 'Updated'
        service.events[eventName] = new EventDefinition({
          name: eventName,
          execute(properties) {
            const data = properties.data
            const session = properties.session
            return modelRuntime().update(session, { ...data, session, id: session })
          }
        })
        const actionName = 'updateSession' + modelName
        service.actions[actionName] = new ActionDefinition({
          name: actionName,
          properties: {
            ...originalModelProperties
          },
          access: config.updateAccess || config.writeAccess,
          skipValidation: true,
          queuedBy: (command) => command.client.session,
          waitForEvents: true,
          async execute(properties, { client, service }, emit) {
            const entity = await modelRuntime().get(client.session)
            if(!entity) throw new Error('not_found')
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
              session: client.session,
              data: properties || {}
            })
          }
        })
        const action = service.actions[actionName]
        const validators = App.validation.getValidators(action, service, action)
      }
      if(config.resetAccess || config.writeAccess) {
        const eventName = 'session' + modelName + 'Reset'
        service.events[eventName] = new EventDefinition({
          name: eventName,
          execute({session}) {
            return modelRuntime().delete(session)
          }
        })
        const actionName = 'resetSession' + modelName
        service.actions[actionName] = new ActionDefinition({
          name: actionName,
          access: config.createAccess || config.writeAccess,
          queuedBy: (command) => command.client.session,
          waitForEvents: true,
          async execute(properties, {client, service}, emit) {
            const entity = await modelRuntime().indexObjectGet('bySession', client.session)
            if (!entity) throw new Error('not_found')
            emit({
              type: eventName,
              session: client.session,
            })
          }
        })
      }
    }
  }

})