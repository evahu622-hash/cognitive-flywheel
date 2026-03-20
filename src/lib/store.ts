"use client";

import { createContext, useContext } from "react";
import { KnowledgeItem, MOCK_KNOWLEDGE, COGNITIVE_PROFILE } from "./mock-data";

// Simple global state for demo (no external dependencies needed)
export interface AppState {
  knowledge: KnowledgeItem[];
  flywheelTurns: number;
  totalKnowledge: number;
  totalThoughts: number;
  totalConnections: number;
}

// In-memory state for the demo
let globalState: AppState = {
  knowledge: [...MOCK_KNOWLEDGE],
  flywheelTurns: COGNITIVE_PROFILE.flywheelTurns,
  totalKnowledge: COGNITIVE_PROFILE.totalKnowledge,
  totalThoughts: COGNITIVE_PROFILE.totalThoughts,
  totalConnections: COGNITIVE_PROFILE.totalConnections,
};

let listeners: (() => void)[] = [];

export function getState() {
  return globalState;
}

export function addKnowledge(item: KnowledgeItem) {
  globalState = {
    ...globalState,
    knowledge: [item, ...globalState.knowledge],
    totalKnowledge: globalState.totalKnowledge + 1,
    flywheelTurns: globalState.flywheelTurns + 1,
  };
  listeners.forEach((l) => l());
}

export function incrementFlywheelTurn() {
  globalState = {
    ...globalState,
    flywheelTurns: globalState.flywheelTurns + 1,
  };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}
