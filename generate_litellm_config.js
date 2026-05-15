const fs = require('fs');
const path = require('path');

const TOKENS_FILE = path.join(__dirname, 'tokens.json');
const CONFIG_FILE = path.join(__dirname, 'litellm_config.yaml');

function generateConfig() {
    let tokens = [];
    try {
        tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    } catch (e) {
        console.error('Error reading tokens.json:', e.message);
        return;
    }

    const models = [
        'claude-opus-4.6', 'claude-opus-4.7', 'claude-sonnet-4.6', 'claude-haiku-4.5',
        'gemini-3.1-pro', 'gemini-3-flash-preview',
        'kimi-k2.5', 'kimi-k2', 'minimax-m2.5',
        'deepseek-v3', 'deepseek-r1',
        'gpt-4o', 'o3', 'grok-4.1', 'glm-5', 'qwen3-coder'
    ];

    let yaml = 'model_list:\n';

    tokens.forEach((token, index) => {
        const cleanToken = token.startsWith('token=') ? token : `token=${token}`;
        
        models.forEach(modelId => {
            yaml += `  - model_name: ${modelId}\n`;
            yaml += `    litellm_params:\n`;
            yaml += `      model: openai/custom\n`;
            yaml += `      api_base: https://desktop-llm.skywork.ai/skycowork_llm/v1\n`;
            yaml += `      api_key: dummy\n`;
            yaml += `      extra_headers:\n`;
            yaml += `        x-skywork-cookies: "${cleanToken}"\n`;
            yaml += `        Origin: "https://skywork.ai"\n`;
            yaml += `        Referer: "https://skywork.ai/"\n`;
            yaml += `    model_info:\n`;
            yaml += `      id: "skywork-${index}-${modelId.split('-')[0]}"\n`;
        });
    });

    yaml += `
litellm_settings:
  drop_params: true
  set_verbose: false
  num_retries: 5
  request_timeout: 60
  telemetry: false

router_settings:
  routing_strategy: latency-based-routing
  enable_pre_call_checks: true
  model_group_alias:
    "gpt-4": "gpt-4o"
`;

    fs.writeFileSync(CONFIG_FILE, yaml);
    console.log(`Generated LiteLLM config with ${tokens.length} tokens.`);
}

if (require.main === module) {
    generateConfig();
}

module.exports = generateConfig;
