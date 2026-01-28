import { test, expect, spyOn, mock, beforeAll, afterAll } from "bun:test";
import { detectOllama } from "../../src/provider/ollama";

const ORIGINAL_FETCH = global.fetch;

test("detectOllama returns models when running", async () => {
    const mockFetch = mock((url: string | URL | Request) => {
        return Promise.resolve(new Response(JSON.stringify({
            models: [
                {
                    name: "llama3:latest",
                    model: "llama3:latest",
                    modified_at: "2024-04-18T00:00:00.0000000+00:00",
                    size: 4000000000,
                    digest: "sha256:12345",
                    details: {
                        family: "llama",
                        parameter_size: "8B",
                        quantization_level: "Q4_0"
                    }
                }
            ]
        })));
    });

    global.fetch = mockFetch as any;

    const result = await detectOllama();
    expect(result.running).toBe(true);
    expect(result.models.length).toBe(1);
    expect(result.models[0].name).toBe("Llama3");

    global.fetch = ORIGINAL_FETCH;
});

test("detectOllama handles connection error gracefully", async () => {
    const mockFetch = mock(() => Promise.reject(new TypeError("Connection refused")));
    global.fetch = mockFetch as any;

    const result = await detectOllama();
    expect(result.running).toBe(false);
    expect(result.models.length).toBe(0);

    global.fetch = ORIGINAL_FETCH;
});

// We can't easily test the actual timeout without making the test slow,
// but we can verify that the signal is passed.
test("detectOllama passes signal to fetch", async () => {
    let capturedSignal: AbortSignal | null | undefined = null;
    const mockFetch = mock((url, options) => {
        capturedSignal = options?.signal as AbortSignal;
        return Promise.resolve(new Response(JSON.stringify({ models: [] })));
    });
    global.fetch = mockFetch as any;

    await detectOllama();

    expect(capturedSignal).toBeDefined();
    // Verify it's not the default 3s anymore (we can't easily check the exact time limit property on AbortSignal without internal access, 
    // but the presence confirms it's being used)

    global.fetch = ORIGINAL_FETCH;
});
