export async function sendSMS(phoneNumber: string, message: string) {
    try {
        const response = await fetch('http://www.toplusmsyolla.com/smsgonder1Npost.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `data=<sms>
                <kno>${process.env.SMS_USER_NO}</kno>
                <kulad>${process.env.SMS_USERNAME}</kulad>
                <sifre>${process.env.SMS_PASSWORD}</sifre>
                <gonderen>${process.env.SMS_ORIGINATOR}</gonderen>
                <mesaj>${message}</mesaj>
                <numaralar>${phoneNumber}</numaralar>
                <tur>Normal</tur>
            </sms>`
        });

        const result = await response.text();
        return { success: true, result };
    } catch (error) {
        return { success: false, error };
    }
} 