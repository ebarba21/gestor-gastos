import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Limpia el DOM renderizado despues de cada test.
afterEach(() => {
  cleanup();
});
