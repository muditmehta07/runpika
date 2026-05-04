import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { trySpawnCommandLine } from 'resource:///org/gnome/shell/misc/util.js';
import { PopupSeparatorMenuItem } from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { SYSTEM_MONITOR_COMMAND, enumToDisplayingItems, gioSettingsKeys, gObjectProperties, gObjectPropertyNames } from './constants.js';
import { getAnimationInterval, spritesGenerator } from './utils.js';
import createCpuGenerator, { MAX_CPU_UTILIZATION } from './dataProviders/cpu.js';

export default class RunPikaIndicator extends PanelMenu.Button {
	static {
		GObject.registerClass({ Properties: gObjectProperties }, this);
	}

	#extension;
	#sourceIds = {};
	#dataProviders = { cpu: createCpuGenerator() };
	#data = { cpu: 0 };
	#icons;
	#formatter = new Intl.NumberFormat(undefined, {
		maximumFractionDigits: 0,
		style: 'percent',
	});

	constructor(extension) {
		super(0.5, 'RunPika', false);
		this.#extension = extension;

		this.#initSettingsListeners();
		this.#initUi();
		this.#initIcons();
		this.#initSources();
	}

	async refreshData() {
		const { value: cpuValue } = await this.#dataProviders.cpu.next();
		this.#data.cpu = cpuValue;
	}

	repaintUi() {
		let utilization = this.#data?.cpu;
		let isActive = utilization > this.idleThreshold / 100;

		if (this.isSpeedInverted) {
			utilization = MAX_CPU_UTILIZATION - utilization;
			isActive = true;
		}

		const characterState = isActive ? 'active' : 'idle';
		const [sprite, spritesCount] = this.#icons[characterState].next().value;

		this.currentIcon = sprite;
		this.currentText = this.#formatter.format(this.#data.cpu);

		const animationInterval = getAnimationInterval(utilization, spritesCount);

		this.#sourceIds.repaintUi = GLib.timeout_add(GLib.PRIORITY_DEFAULT, animationInterval, () => this.repaintUi());

		return GLib.SOURCE_REMOVE;
	}

	#initIcons() {
		this.#icons = {
			idle: spritesGenerator(this.#extension.path, 'idle'),
			active: spritesGenerator(this.#extension.path, 'active'),
		};

		const [sprite] = this.#icons.idle.next().value;
		this.currentIcon = sprite;
	}

	#initUi() {
		// Build the UI using St instead of Gtk.Builder
		const box = new St.BoxLayout({
			style_class: 'panel-status-menu-box',
		});

		const icon = new St.Icon({
			style_class: 'system-status-icon',
		});

		const label = new St.Label({
			y_align: Clutter.ActorAlign.CENTER,
		});

		// Re-establish the property bindings previously handled by Gtk.Builder
		this.bind_property(gObjectPropertyNames.currentText, label, 'text', GObject.BindingFlags.DEFAULT);
		this.bind_property_full(
			gObjectPropertyNames.displayingItems,
			label,
			'visible',
			GObject.BindingFlags.SYNC_CREATE,
			(_, { percentage }) => [true, percentage],
			null
		);

		this.bind_property(gObjectPropertyNames.currentIcon, icon, 'gicon', GObject.BindingFlags.DEFAULT);
		this.bind_property_full(
			gObjectPropertyNames.displayingItems,
			icon,
			'visible',
			GObject.BindingFlags.SYNC_CREATE,
			(_, { character }) => [true, character],
			null
		);

		this.bind_property(gObjectPropertyNames.iconSize, icon, 'icon_size', GObject.BindingFlags.SYNC_CREATE);

		// Assemble the hierarchy
		box.add_child(icon);
		box.add_child(label);
		this.add_child(box);

		// Menu items
		this.menu.addAction(_('Open System Monitor'), () => {
			const command = this.useCustomSystemMonitor
				? this.customSystemMonitorCommand
				: SYSTEM_MONITOR_COMMAND;

			try {
				trySpawnCommandLine(command);
			} catch (e) {
				if (e instanceof Error) {
					Main.notifyError(_('Execution of “%s” failed').format(command), e.message);
				}
				console.error(e);
			}
		});

		this.menu.addMenuItem(new PopupSeparatorMenuItem());

		this.menu.addAction(_('Settings'), () => {
			try {
				this.#extension.openPreferences();
			} catch (e) {
				if (e instanceof Error) {
					Main.notifyError(_('Failed to open extension settings'), e.message);
				}
				console.error(e);
			}
		});
	}

	#initSettingsListeners() {
		const settings = this.#extension.getSettings();

		settings.bind(gioSettingsKeys.INVERT_SPEED, this, gObjectPropertyNames.isSpeedInverted, Gio.SettingsBindFlags.DEFAULT);
		settings.bind(gioSettingsKeys.IDLE_THRESHOLD, this, gObjectPropertyNames.idleThreshold, Gio.SettingsBindFlags.DEFAULT);
		settings.bind(gioSettingsKeys.customSystemMonitor.ENABLED, this, gObjectPropertyNames.useCustomSystemMonitor, Gio.SettingsBindFlags.DEFAULT);
		settings.bind(gioSettingsKeys.customSystemMonitor.COMMAND, this, gObjectPropertyNames.customSystemMonitorCommand, Gio.SettingsBindFlags.DEFAULT);
		settings.bind(gioSettingsKeys.ICON_SIZE, this, gObjectPropertyNames.iconSize, Gio.SettingsBindFlags.DEFAULT);

		const updateDisplayingItems = () => {
			const option = settings.get_enum(gioSettingsKeys.DISPLAYING_ITEMS);
			this.displayingItems = enumToDisplayingItems[option];
		};

		updateDisplayingItems();
		settings.connect(`changed::${gioSettingsKeys.DISPLAYING_ITEMS}`, updateDisplayingItems);
	}

	async #initSources() {
		await this.refreshData();
		this.#sourceIds.refreshData = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3_000, () => {
			this.refreshData();
			return GLib.SOURCE_CONTINUE;
		});

		this.#sourceIds.repaintUi = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => this.repaintUi());
	}

	destroy() {
		if (this.#sourceIds.refreshData) {
			GLib.source_remove(this.#sourceIds.refreshData);
		}
		if (this.#sourceIds.repaintUi) {
			GLib.source_remove(this.#sourceIds.repaintUi);
		}
		super.destroy();
	}
}