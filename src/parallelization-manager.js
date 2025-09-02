// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// Shared parallelization manager for compareMS2
// This module manages parallel execution across all comparison modes to prevent 
// oversubscription of system resources when multiple comparison windows are open.

const { getCPUCount } = require('./main-common.js');

class ParallelizationManager {
    constructor() {
        this.totalMaxParallel = getCPUCount();
        this.activeSlots = 0;
        this.waitingQueue = [];
    }

    setMaxParallel(maxParallel) {
        // Ensure we have at least 1 and at most a reasonable number
        this.totalMaxParallel = Math.max(1, Math.min(maxParallel, 128));
    }

    async acquireSlot() {
        return new Promise((resolve) => {
            if (this.activeSlots < this.totalMaxParallel) {
                this.activeSlots++;
                resolve();
            } else {
                this.waitingQueue.push(resolve);
            }
        });
    }

    releaseSlot() {
        this.activeSlots--;
        if (this.waitingQueue.length > 0 && this.activeSlots < this.totalMaxParallel) {
            const resolve = this.waitingQueue.shift();
            this.activeSlots++;
            resolve();
        }
    }

    getAvailableSlots() {
        return this.totalMaxParallel - this.activeSlots;
    }

    getTotalSlots() {
        return this.totalMaxParallel;
    }

    getActiveSlots() {
        return this.activeSlots;
    }

    // Execute multiple tasks in parallel with controlled concurrency
    async executeTasksInParallel(tasks, maxConcurrency = null) {
        const effectiveMaxConcurrency = maxConcurrency || this.totalMaxParallel;
        const results = [];
        const runningTasks = new Set();
        let taskIndex = 0;

        async function scheduleNextTask() {
            if (taskIndex >= tasks.length || runningTasks.size >= effectiveMaxConcurrency) {
                return;
            }

            const task = tasks[taskIndex++];
            const taskPromise = this.executeTask(task);
            runningTasks.add(taskPromise);

            taskPromise
                .then((result) => {
                    results.push(result);
                })
                .catch((error) => {
                    results.push({ error });
                })
                .finally(async () => {
                    runningTasks.delete(taskPromise);
                    await scheduleNextTask.call(this);
                });

            if (runningTasks.size < effectiveMaxConcurrency && taskIndex < tasks.length) {
                await scheduleNextTask.call(this);
            }
        }

        // Start initial batch of tasks
        const initialPromises = [];
        for (let i = 0; i < Math.min(effectiveMaxConcurrency, tasks.length); i++) {
            initialPromises.push(scheduleNextTask.call(this));
        }

        await Promise.all(initialPromises);

        // Wait for all tasks to complete
        while (runningTasks.size > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return results;
    }

    async executeTask(task) {
        await this.acquireSlot();
        try {
            return await task();
        } finally {
            this.releaseSlot();
        }
    }
}

// Global instance
const parallelizationManager = new ParallelizationManager();

function getParallelizationManager() {
    return parallelizationManager;
}

function initializeParallelization(maxParallel) {
    parallelizationManager.setMaxParallel(maxParallel);
}

exports.getParallelizationManager = getParallelizationManager;
exports.initializeParallelization = initializeParallelization;
exports.ParallelizationManager = ParallelizationManager;
