import { expect, it } from 'vitest';
import type { Pull } from '../types';
import { bossUrl, reportCode, wclPullLabel } from './wcl';

const pull = { encounterId: 3421, difficultyId: 16, success: false, pullNumber: 24, pullNumberAll: 25 } as Pull;

it('extrai o código do report do link', () => {
  expect(reportCode('https://www.warcraftlogs.com/reports/xFLWV9Yay2HZwrQk')).toBe('xFLWV9Yay2HZwrQk');
  expect(reportCode('www.warcraftlogs.com/reports/xFLWV9Yay2HZwrQk?fight=3&type=deaths')).toBe('xFLWV9Yay2HZwrQk');
  expect(reportCode(' xFLWV9Yay2HZwrQk ')).toBe('xFLWV9Yay2HZwrQk');
  expect(reportCode('nada')).toBeNull();
});

it('abre o report filtrado no boss e dificuldade (formato validado no WCL)', () => {
  expect(bossUrl('xFLWV9Yay2HZwrQk', pull)).toBe('https://www.warcraftlogs.com/reports/xFLWV9Yay2HZwrQk?boss=3421&difficulty=5&wipes=1');
});

it('usa a numeração do WCL, que conta os pulls curtos', () => {
  expect(wclPullLabel(pull)).toBe('Wipe 25');
});
