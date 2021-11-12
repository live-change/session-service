const definition = require("./definition.js")

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

module.exports = Session
