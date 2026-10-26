#!/usr/bin/env node
import { main } from '../cli/main.mjs';
await main(process.argv.slice(2));
