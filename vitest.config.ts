import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 25000,
    projects: [
      {
        test: {
          testTimeout: 25000,
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/benchmark.test.ts", "tests/overlayBenchmark.test.ts"]
        }
      },
      {
        test: {
          testTimeout: 60000,
          name: "benchmark-overlay",
          include: ["tests/overlayBenchmark.test.ts"],
          pool: "forks",
          forks: {
            singleFork: true
          }
        }
      },
      {
        test: {
          name: "benchmark",
          include: ["tests/benchmark.test.ts"],
          pool: "forks",
          forks: {
            singleFork: true
          }
        }
      },
      {
        test: {
          name: "profile",
          include: ["scripts/**/*.ts"],
          pool: "forks",
          forks: {
            singleFork: true
          }
        }
      }
    ]
  }
});
