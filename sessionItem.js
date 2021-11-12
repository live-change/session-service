const definition = require("./definition.js")
const App = require("@live-change/framework")
const { PropertyDefinition, ViewDefinition, IndexDefinition, ActionDefinition, EventDefinition } = App
const Session = require("./model.js")

definition.processor(function(service, app) {

  for(let modelName in service.models) {
    const model = service.models[modelName]
    if(model.sessionItem) {
      console.trace("PROCESS MODEL " + modelName)
      if (model.properties.session) throw new Error('session property already exists!!!')
      const originalModelProperties = {...model.properties}
      const modelProperties = Object.keys(model.properties)
      const defaults = App.utils.generateDefault(modelProperties)
      const modelPropertyName = modelName.slice(0, 1).toLowerCase() + modelName.slice(1)

      function modelRuntime() {
        return service._runtime.models[modelName]
      }

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
            const path = modelRuntime().indexRangePath('bySession', [client.session], range )
            return path
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
        const eventName = 'session' + modelName + 'Created'
        service.events[eventName] = new EventDefinition({
          name: eventName,
          execute(properties) {
            const data = properties.data
            const session = properties.session
            const id = properties[modelPropertyName]
            return modelRuntime().create({ ...data, session, id })
          }
        })
        const actionName = 'createSession' + modelName
        service.actions[actionName] = new ActionDefinition({
          name: actionName,
          access: config.createAccess || config.writeAccess,
          properties: {
            ...originalModelProperties,
            [modelPropertyName]: {
              type: model,
              validation: ['localId']
            }
          },
          queuedBy: (command) => command.client.session,
          waitForEvents: true,
          async execute(properties, { client, service }, emit) {
            const id = properties[modelPropertyName] || app.generateUid()
            emit({
              type: eventName,
              [modelPropertyName]: id,
              session: client.session,
              data: properties
            })
            return id
          }
        })
      }
      if(config.updateAccess || config.writeAccess) {
        const eventName = 'session' + modelName + 'Updated'
        service.events[eventName] = new EventDefinition({
          name: eventName,
          execute(properties) {
            const data = properties.data
            const id = properties[modelPropertyName]
            const session = properties.session
            return modelRuntime().update(id, { ...data, id, session })
          }
        })
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
          skipValidation: true,
          queuedBy: (command) => command.client.session,
          waitForEvents: true,
          async execute(properties, { client, service }, emit) {
            const entity = await modelRuntime().get(properties[modelPropertyName])
            if(!entity) throw new Error('not_found')
            if(entity.session != client.session) throw new Error('not_authorized')
            let updateObject = {}
            for(const propertyName of writeableProperties) {
              if(properties.hasOwnProperty(propertyName)) {
                updateObject[propertyName] = properties[propertyName]
              }
            }
            const merged = App.utils.mergeDeep({}, entity, updateObject)
            console.log("VALIDATE INTERNAL!!!!", merged)
            await App.validation.validate(merged, validators, { source: action, action, service, app, client })
            emit({
              type: eventName,
              [modelPropertyName]: entity.id,
              session: client.session,
              data: properties
            })
          }
        })
        const action = service.actions[actionName]
        const validators = App.validation.getValidators(action, service, action)
      }
      if(config.deleteAccess || config.writeAccess) {
        const eventName = 'session' + modelName + 'Deleted'
        service.events[eventName] = new EventDefinition({
          name: eventName,
          execute(properties) {
            const id = properties[modelPropertyName]
            return modelRuntime().delete(id)
          }
        })
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
          queuedBy: (command) => command.client.session,
          waitForEvents: true,
          async execute(properties, { client, service }, emit) {
            const entity = await modelRuntime().get(properties[modelPropertyName])
            if(!entity) throw new Error('not_found')
            if(entity.session != client.session) throw new Error('not_authorized')
            emit({
              type: eventName,
              session: client.session,
              [modelPropertyName]: entity.id
            })
          }
        })
      }
    }
  }

})