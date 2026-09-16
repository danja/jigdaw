JigDAW will be a Web-native system that contains two types of component. A digital audio workstation and plugins.
It will carry the same kind of functionality typically carried at present by a DAW and VST plugins. The difference will be that everything will be online. This calls for a specification of the available facilities offered by host and plugins.
A typical scenario will be that the user loads the core DAW in their browser and searches for instruments and effects. They find what they want and include it in their setup. Every component will have a machine-readable profile so that they are findable. Check the Plugin Profiles and instrument descriptions used in /home/danny/github/transmission /home/danny/github/valis /home/danny/github/downspout and plugin-universe.com - their CLAUDE.md files will have general instructions that should be used as a basis for this project's CLAUDE.md

The DAW and the plugins should make maximal use of WASM.

Every significant component should be identified with an IRI, and they should ideally be dereferenceable. So if a user searches for a plugin they will find a URL, do a HTTP GET and the plugin is installed.

For an initial implementation the DAW can be built in a Podman container along with a SPARQL store which will contain all appropriate data.

WebMCP will be built in.

