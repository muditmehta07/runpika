import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'
import { panel as MainPanel } from 'resource:///org/gnome/shell/ui/main.js'
import RunPikaIndicator from './indicator.js'


export default class RunPikaExtension extends Extension {
	#indicator = null

	enable() {
		this.#indicator = new RunPikaIndicator(this)
		MainPanel.addToStatusArea('runpika-indicator', this.#indicator)
	}

	disable() {
		this.#indicator?.destroy()
		this.#indicator = null
	}
}
