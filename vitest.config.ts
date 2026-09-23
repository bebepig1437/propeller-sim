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
          exclude: ["tests/benchmark.test.ts"]
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
