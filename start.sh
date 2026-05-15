#!/bin/bash

# تثبيت التبعيات إذا لم تكن موجودة (لبيئة Docker)
if [ -f "package.json" ]; then
    npm install
fi

# توليد إعدادات LiteLLM الأولية
node generate_litellm_config.js

# تشغيل خادم التوكنات (الجامع فقط) في الخلفية كسكربت
node index.js &

# تشغيل LiteLLM كبروكسي أساسي
# سيقوم LiteLLM بالاستماع على المنفذ الذي يحدده Render (غالباً 10000 أو عبر PORT env)
# سنستخدم PORT الافتراضي لـ Render للبروكسي
PORT=${PORT:-3000}
# تشغيل LiteLLM على المنفذ الذي يطلبه Render
# سنضيف --host 0.0.0.0 للتأكد من استقبال الطلبات الخارجية
litellm --config litellm_config.yaml --port $PORT --host 0.0.0.0 --detailed_debug
