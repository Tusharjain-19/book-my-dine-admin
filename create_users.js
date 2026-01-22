const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5c3pib3Bydnh3aHVxZXJiYnZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjU1MDEwOSwiZXhwIjoyMDgyMTI2MTA5fQ.68tJo2l4nm2SjZJ4ael2dCd0rN6NXQpqWhKKmIkcYiM'
);

const users = [
  { email: 'rahul@test.com', password: 'test 1234', name: 'Rahul' },
  { email: 'amit@test.com', password: 'test1234', name: 'Amit' },
  { email: 'priya@test.com', password: 'test 1234', name: 'Priya' }
];

async function createUsers() {
  for (const user of users) {
    console.log(`Creating user: ${user.email}...`);
    const { data, error } = await supabase.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { name: user.name }
    });

    if (error) {
      console.error(`Error creating ${user.email}:`, error.message);
    } else {
      console.log(`User created: ${data.user.id}`);
      // Insert into profiles
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: data.user.id,
          name: user.name,
          role: 'waiter'
        });
      
      if (profileError) {
        console.error(`Error creating profile for ${user.email}:`, profileError.message);
      } else {
        console.log(`Profile created for ${user.name}`);
      }
    }
  }
}

createUsers();
