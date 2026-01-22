const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://fyszboprvxwhuqerbbvm.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5c3pib3Bydnh3aHVxZXJiYnZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjU1MDEwOSwiZXhwIjoyMDgyMTI2MTA5fQ.68tJo2l4nm2SjZJ4ael2dCd0rN6NXQpqWhKKmIkcYiM';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const emails = ['rahul@test.com', 'amit@test.com', 'priya@test.com'];

async function reset() {
    const { data: { users }, error } = await sb.auth.admin.listUsers();
    if (error) {
        console.error('Error listing users:', error);
        return;
    }

    for (const email of emails) {
        const user = users.find(u => u.email === email);
        if (user) {
            const { error: updateError } = await sb.auth.admin.updateUserById(user.id, { password: 'test1234' });
            if (updateError) {
                console.error(`Error updating ${email}:`, updateError.message);
            } else {
                console.log(`Successfully reset password for ${email}`);
            }
        } else {
            console.log(`User not found: ${email}`);
        }
    }
}

reset();
