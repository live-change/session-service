const definition = require("./definition.js")

const Session = definition.model({
  name: "Session",
  properties: {
    key: {
      type: String
    }
  },
  indexes: {
    byKey: {
      property: 'key'
    }
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
    await Session.create({
      id: session,
      key: key
    })
  }
})

module.exports = { Session }
