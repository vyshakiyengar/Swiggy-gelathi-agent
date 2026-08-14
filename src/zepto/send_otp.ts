import { zeptoLiveApiService } from './live_api';

async function triggerOtp() {
  const phone = '7259140866';
  console.log(`📲 Requesting Zepto to send SMS OTP to +91 ${phone}...`);
  try {
    const result = await zeptoLiveApiService.sendOtp(phone);
    console.log(`✅ ${result.message}`);
  } catch (e: any) {
    console.error(`❌ Zepto OTP request failed:`, e.message);
  }
}

triggerOtp();
