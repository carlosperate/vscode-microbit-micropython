import { describe, expect, it, vi } from 'vitest';

import { openSerialRoute, type SerialRouteActions } from '../src/serial/route';

function actions(overrides: Partial<SerialRouteActions> = {}) {
	const calls: string[] = [];
	const result: SerialRouteActions = {
		browserDeviceBridges: true,
		hasWebUsb: vi.fn(async () => false),
		hasWebSerial: vi.fn(async () => false),
		openNative: vi.fn(async () => {
			calls.push('native');
			return true;
		}),
		openWebUsb: vi.fn(async () => {
			calls.push('webusb');
			return true;
		}),
		openWebSerial: vi.fn(async () => {
			calls.push('webserial');
			return true;
		}),
		offerWebSerial: vi.fn(async () => {
			calls.push('offer');
			return true;
		}),
		unsupported: vi.fn(() => calls.push('unsupported')),
		...overrides,
	};
	return { calls, actions: result };
}

describe('serial route priority', () => {
	it('uses native serial when the browser device bridges are absent', async () => {
		const setup = actions({ browserDeviceBridges: false });

		await expect(openSerialRoute(setup.actions)).resolves.toBe('native');
		expect(setup.calls).toEqual(['native']);
		expect(setup.actions.hasWebUsb).not.toHaveBeenCalled();
	});

	it('uses WebUSB before Web Serial when WebUSB opens', async () => {
		const setup = actions({ hasWebUsb: vi.fn(async () => true) });

		await expect(openSerialRoute(setup.actions)).resolves.toBe('webusb');
		expect(setup.calls).toEqual(['webusb']);
		expect(setup.actions.hasWebSerial).not.toHaveBeenCalled();
	});

	it('uses Web Serial directly when WebUSB is absent', async () => {
		const setup = actions({ hasWebSerial: vi.fn(async () => true) });

		await expect(openSerialRoute(setup.actions)).resolves.toBe('webserial');
		expect(setup.calls).toEqual(['webserial']);
	});

	it('does not open a second chooser unless the offered fallback is accepted', async () => {
		const setup = actions({
			hasWebUsb: vi.fn(async () => true),
			hasWebSerial: vi.fn(async () => true),
			openWebUsb: vi.fn(async () => {
				setup.calls.push('webusb');
				return false;
			}),
			offerWebSerial: vi.fn(async () => {
				setup.calls.push('offer');
				return false;
			}),
		});

		await expect(openSerialRoute(setup.actions)).resolves.toBe('cancelled');
		expect(setup.calls).toEqual(['webusb', 'offer']);
	});

	it('opens Web Serial after an accepted fallback', async () => {
		const setup = actions({
			hasWebUsb: vi.fn(async () => true),
			hasWebSerial: vi.fn(async () => true),
			openWebUsb: vi.fn(async () => {
				setup.calls.push('webusb');
				return false;
			}),
		});

		await expect(openSerialRoute(setup.actions)).resolves.toBe('webserial');
		expect(setup.calls).toEqual(['webusb', 'offer', 'webserial']);
	});

	it('reports an unsupported browser instead of trying Eclipse', async () => {
		const setup = actions();

		await expect(openSerialRoute(setup.actions)).resolves.toBe('unsupported');
		expect(setup.calls).toEqual(['unsupported']);
	});
});
