function getTodayDate() {
    const now = new Date();
    // Colombia UTC-5
    const colombiaMs = now.getTime() + (-5 * 60 * 60 * 1000) - (now.getTimezoneOffset() * 60 * 1000);
    const colombia = new Date(colombiaMs);
    colombia.setUTCHours(0,0,0,0);
    return colombia;
}
console.log("getTodayDate():", getTodayDate());
