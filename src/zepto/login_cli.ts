import readline from 'readline';
import { zeptoLiveApiService } from './live_api';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log('\n======================================================');
  console.log('🛒 REAL ZEPTO ACCOUNT 1-TIME AUTHENTICATION');
  console.log('======================================================\n');
  console.log('This will connect your real Zepto account once permanently.');
  console.log('Your Mom will never be asked for any login or OTP!\n');

  console.log('Choose an authentication method:');
  console.log('1. Enter Mobile Number to receive an SMS OTP');
  console.log('2. Paste Zepto Session Auth Token / Cookie from browser');

  const choice = await question('\nEnter choice (1 or 2): ');

  if (choice.trim() === '2') {
    const token = await question('\nPaste your Zepto Auth Token / Bearer Token: ');
    if (!token.trim()) {
      console.log('❌ Token cannot be empty.');
      process.exit(1);
    }
    zeptoLiveApiService.setAuthToken(token.trim());
    console.log('\n🎉 Real Zepto account linked permanently! COD orders will now automatically be dispatched on your account.');
    rl.close();
    return;
  }

  const phone = await question('\nEnter your 10-digit Zepto Mobile Number: ');
  const cleanPhone = phone.replace(/\D/g, '').slice(-10);

  if (cleanPhone.length !== 10) {
    console.log('❌ Please enter a valid 10-digit mobile number.');
    process.exit(1);
  }

  console.log(`\n📲 Sending Zepto SMS OTP to +91 ${cleanPhone}...`);

  try {
    const otpRes = await zeptoLiveApiService.sendOtp(cleanPhone);
    console.log(`✅ ${otpRes.message}`);

    const otp = await question('\nEnter the OTP received on your phone: ');
    console.log('\n🔐 Verifying OTP with Zepto servers...');

    const session = await zeptoLiveApiService.verifyOtp(cleanPhone, otp.trim());
    console.log('\n🎉 ======================================================');
    console.log('✅ ZEPTO ACCOUNT LINKED PERMANENTLY!');
    console.log(`Phone: +91 ${session.phoneNumber}`);
    console.log('Token saved to .env file.');
    console.log('Your Mom can now order directly on WhatsApp with automatic COD!');
    console.log('======================================================\n');
  } catch (err: any) {
    console.error('\n❌ Authentication failed:', err.message);
    console.log('\nTip: You can also copy your Zepto Auth token from your browser network tab (app.zeptonow.com) and paste it into .env as ZEPTO_AUTH_TOKEN=...');
  }

  rl.close();
}

main().catch(console.error);
