const App = require("@live-change/framework")
const app = App.app()

const definition = app.createServiceDefinition({
  name: "session"
})

module.exports = definition
