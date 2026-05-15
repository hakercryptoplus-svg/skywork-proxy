# استخدام صورة تحتوي على Python و Node.js
FROM nikolaik/python-nodejs:python3.11-nodejs20

WORKDIR /app

# تثبيت LiteLLM والتبعيات المطلوبة
RUN pip install 'litellm[router]'

# نسخ ملفات المشروع
COPY package*.json ./
RUN npm install

COPY . .

# إعطاء صلاحيات التشغيل لسكربت البداية
RUN chmod +x start.sh

# المنفذ الافتراضي
EXPOSE 3000
EXPOSE 3001

# تشغيل النظام
CMD ["./start.sh"]
