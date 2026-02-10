import { Actor } from 'apify';

import log from '@apify/log';

import type { PipelineState } from '../types.js';

const CHECKPOINT_KEY = 'PIPELINE_STATE';

export async function saveCheckpoint(state: PipelineState): Promise<void> {
    const updated = { ...state, lastUpdated: new Date().toISOString() };
    await Actor.setValue(CHECKPOINT_KEY, updated);
    log.info(`Checkpoint saved at step ${updated.step}: ${updated.stepName}`);
}

export async function loadCheckpoint(): Promise<PipelineState | null> {
    const state = await Actor.getValue<PipelineState>(CHECKPOINT_KEY);
    if (state) {
        log.info(`Checkpoint loaded: resuming from step ${state.step} (${state.stepName})`);
    }
    return state;
}

export async function clearCheckpoint(): Promise<void> {
    await Actor.setValue(CHECKPOINT_KEY, null);
    log.info('Checkpoint cleared.');
}
