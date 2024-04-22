require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const bodyParser = require('body-parser');

const app = express();
app.use(express.json());
app.use(bodyParser.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? true : { rejectUnauthorized: false },
  });
  
  // Function to check and create table if not exists, and ensure UUID extension is enabled
  async function initializeDatabase() {
    const enableUUIDExtensionQuery = `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`;
    
    const createUsersTableQuery = `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        contact VARCHAR(255) NOT NULL,
        course VARCHAR(255) NOT NULL,
        level INT NOT NULL,
        roll_id VARCHAR(255) NOT NULL UNIQUE
      );
    `;
  
    const createCounselorsTableQuery = `
      CREATE TABLE IF NOT EXISTS counselors (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        specialization VARCHAR(255),
        location VARCHAR(255)
      );
    `;

    const alterCounselorsTableToAddAvailability = `
    ALTER TABLE counselors
    ADD COLUMN IF NOT EXISTS availability JSONB DEFAULT '{}';
  `;
  
    const createAppointmentsTableQuery = `
      CREATE TABLE IF NOT EXISTS appointments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        appointment_time TIMESTAMP WITHOUT TIME ZONE NOT NULL,
        counselor_id UUID NOT NULL REFERENCES counselors(id),
        student_id UUID NOT NULL REFERENCES users(id),
        status VARCHAR(50) NOT NULL,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT
      );
    `;
  
    const createThoughtDiariesTableQuery = `
  CREATE TABLE IF NOT EXISTS thought_diaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES users(id),
    entry_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    content TEXT NOT NULL,
    mood VARCHAR(255),  -- Replacing tags with mood, assuming mood is a single descriptive string
    title VARCHAR(255) NOT NULL,  -- Adding title column
    color VARCHAR(255)  -- Adding color column, assumed to be a CSS-compatible color representation
  );
`;


    // Added table creation queries for workouts and exercises
    const createWorkoutsTableQuery = `
      CREATE TABLE IF NOT EXISTS workouts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        difficulty VARCHAR(50),
        duration INT, -- Duration in minutes
        created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
      );
    `;
 

    const createStudentWorkoutsTableQuery = `
      CREATE TABLE IF NOT EXISTS student_workouts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        student_id UUID NOT NULL REFERENCES users(id),
        workout_id UUID NOT NULL REFERENCES workouts(id),
        status VARCHAR(50), -- e.g., 'completed', 'pending'
        completed_at TIMESTAMP WITHOUT TIME ZONE,
        feedback TEXT -- Optional feedback after completing the workout
        
      );
    `;

    const createStudentExercisesTableQuery = `
    CREATE TABLE IF NOT EXISTS student_exercises (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      workout_id UUID NOT NULL REFERENCES student_workouts(id),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      repetitions INT,
      sets INT,
      duration INT, -- Duration in seconds per set
      rest_period INT, -- Rest in seconds between sets
      student_id UUID NOT NULL REFERENCES users(id)
    );
  `;
  
  

    try {
      await pool.query(enableUUIDExtensionQuery);
      await pool.query(createUsersTableQuery);
      await pool.query(createCounselorsTableQuery);
      await pool.query(alterCounselorsTableToAddAvailability);
      await pool.query(createAppointmentsTableQuery);
      await pool.query(createThoughtDiariesTableQuery);
      // Execute the newly added table creation queries
      await pool.query(createWorkoutsTableQuery);
      await pool.query(createStudentWorkoutsTableQuery);
      await pool.query(createStudentExercisesTableQuery);
      console.log("Database initialization complete with support for users, counselors, appointments, thought diaries, workouts, and exercises.");
    } catch (error) {
      console.error("Error initializing database:", error);
      process.exit(1);
    }
}
// async function dropThoughtDiariesTable() {
//   const dropTableQuery = `DROP TABLE IF EXISTS student_exercises;`;

//   try {
//       await pool.query(dropTableQuery);
//       console.log("Thought Diaries table dropped successfully.");
//   } catch (error) {
//       console.error("Error dropping Thought Diaries table:", error);
//       process.exit(1);
//   }
// }

// dropThoughtDiariesTable();


  
  
  // Call the database initialization function before starting the server
  initializeDatabase().then(() => {
    console.log("Database initialization completed.");
    app.listen(process.env.PORT || 3000, () => {
      console.log(`Server running on port ${process.env.PORT || 3000}`);
    });
  });
  
  app.get('/', (req, res) => {
    res.send('Server is up and running!');
  });
  
  // Signup route
  app.post('/signup', async (req, res) => {
    const { email, password, first_name, last_name, contact, course, level, roll_id } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10); // Salt rounds is 10
  
    try {
      // Check if a user with the same email or roll_id already exists
      const existingUser = await pool.query('SELECT * FROM users WHERE email = $1 OR roll_id = $2', [email, roll_id]);
      if (existingUser.rows.length > 0) {
        return res.status(400).json({error: 'User already exists with that email or roll ID.'});
      }
  
      // Insert the new user with the additional information
      const newUser = await pool.query(
        'INSERT INTO users (email, password_hash, first_name, last_name, contact, course, level, roll_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *', 
        [email, hashedPassword, first_name, last_name, contact, course, level, roll_id]
      );
  
      res.status(201).json({message: `User created with ID: ${newUser.rows[0].id}`});
    } catch (error) {
      console.error(error);
      res.status(500).json({message: 'Server error during signup.'});
    }
  });
  
  

// Login route
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
  
    try {
      const userQueryResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (userQueryResult.rows.length === 0) {
        return res.status(400).json({error:'User not found.'});
      }
  
      const user = userQueryResult.rows[0];
      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        return res.status(400).json({error:'Invalid password.'});
      }
  
      // Send back the user ID (and any other public user information you wish to include)
      res.json({
        message: 'Login successful!',
        userId: user.id
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({message:'Server error during login.'});
    }
  });

//book appointments
app.post('/book-appointment', async (req, res) => {
    const { appointmentTime, counselorId, studentId, status, type, title, description } = req.body;
  
    try {
        // First, validate the existence of the counselor
        const counselorExists = await pool.query('SELECT * FROM counselors WHERE id = $1', [counselorId]);
        if (counselorExists.rows.length === 0) {
            return res.status(404).json({error: 'Counselor not found.'});
        }

        // Parse the appointment time as UTC
        const appointmentStart = new Date(appointmentTime);
        // Calculate the appointment end time by adding 3600000 milliseconds (1 hour)
        const appointmentEnd = new Date(appointmentStart.getTime() + 3600000);

        // Create a new Date object for now in UTC
        const now = new Date(new Date().toISOString());

        // Check if the appointment time is in the past
        if (appointmentStart < now) {
            return res.status(400).json({error: 'Cannot book appointments for a past date.'});
        }

        // Check for overlapping appointments
        const conflictCheckQuery = `
            SELECT * FROM appointments 
            WHERE counselor_id = $1 AND (
            (appointment_time, appointment_time + interval '1 hour') OVERLAPS ($2, $3)
            )
        `;
        const conflictCheck = await pool.query(conflictCheckQuery, [
            counselorId,
            appointmentStart.toISOString(),
            appointmentEnd.toISOString()
        ]);

        if (conflictCheck.rows.length > 0) {
            return res.status(400).json({error: 'This time slot is already booked or overlaps with another appointment.'});
        }

        // Insert the new appointment
        const insertQuery = `
            INSERT INTO appointments (appointment_time, counselor_id, student_id, status, type, title, description) 
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
        `;
        const newAppointment = await pool.query(insertQuery, [
            appointmentStart.toISOString(),
            counselorId,
            studentId,
            status,
            type,
            title,
            description
        ]);

        res.status(201).json(newAppointment.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({error: 'Error booking appointment.'});
    }
});

  
  
  //ge all appointments

  app.get('/list-appointments', async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM appointments');
      res.json(result.rows);
    } catch (error) {
      console.error(error);
      res.status(500).send('Error fetching appointments.');
    }
  });
  



  //get user appointment
  app.get('/user-appointments', async (req, res) => {
    const { userId } = req.query; // Assuming the user ID is passed as a query parameter
  
    if (!userId) {
      return res.status(400).json({ error: 'A user ID must be provided.' });
    }
  
    try {
      // Query to select appointments where the userId matches either the student_id or the counselor_id
      const query = `
        SELECT * FROM appointments
        WHERE student_id = $1 OR counselor_id = $1
        ORDER BY appointment_time;
      `;
      const result = await pool.query(query, [userId]);
  
      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'No appointments found for the given user ID.' });
      }
  
      res.json(result.rows);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Server error retrieving appointments.' });
    }
  });
  
  

  //edit appointment
  app.patch('/update-appointment', async (req, res) => {
     const {appointmentId, appointmentTime, title, description, status, type } = req.body;

     try {
       if (appointmentTime) {
         const newAppointmentStart = new Date(appointmentTime);
         const now = new Date();
   
         if (newAppointmentStart < now) {
           return res.status(400).json({ error: 'Cannot update an appointment to a past date.' });
         }
   
         const appointmentEnd = new Date(newAppointmentStart.getTime() + 3600000); // Assuming 1 hour appointments
   
         const conflictCheckQuery = `
           SELECT * FROM appointments 
           WHERE id != $1 AND (
             (appointment_time, appointment_time + interval '1 hour') OVERLAPS ($2, $3)
           )
         `;
         const conflictCheck = await pool.query(conflictCheckQuery, [
           appointmentId,
           newAppointmentStart.toISOString(),
           appointmentEnd.toISOString()
         ]);
   
         if (conflictCheck.rows.length > 0) {
           return res.status(400).json({ error: 'This time slot is already booked.' });
         }
       }
   
       let updateParts = [];
       let queryParams = [];
       let queryParamIndex = 1;
   
       if (title !== undefined) {
         queryParams.push(title);
         updateParts.push(`title = $${queryParamIndex++}`);
       }
       if (description !== undefined) {
         queryParams.push(description);
         updateParts.push(`description = $${queryParamIndex++}`);
       }
       if (appointmentTime) {
         queryParams.push(appointmentTime);
         updateParts.push(`appointment_time = $${queryParamIndex++}`);
       }
       if (status !== undefined) {
         queryParams.push(status);
         updateParts.push(`status = $${queryParamIndex++}`);
       }
       if (type !== undefined) {
         queryParams.push(type);
         updateParts.push(`type = $${queryParamIndex++}`);
       }
   
       queryParams.push(appointmentId); // For the WHERE clause
   
       const updateQuery = `
         UPDATE appointments
         SET ${updateParts.join(", ")}
         WHERE id = $${queryParamIndex}
         RETURNING *;
       `;
   
       const updatedAppointment = await pool.query(updateQuery, queryParams);
   
       if (updatedAppointment.rows.length === 0) {
         return res.status(404).json({ error: 'Appointment not found.' });
       }
   
       res.json(updatedAppointment.rows[0]);
     } catch (error) {
       console.error(error);
       res.status(500).json({ error: 'Error updating appointment.' });
     }
  });



  //delete appointment
  app.delete('/delete-appointments/:appointmentId', async (req, res) => {
    const { appointmentId } = req.params;
  
    try {
      // Attempt to delete the appointment with the given ID
      const deleteResult = await pool.query('DELETE FROM appointments WHERE id = $1 RETURNING *', [appointmentId]);
  
      // If no rows are returned, the appointment was not found
      if (deleteResult.rows.length === 0) {
        return res.status(404).json({ error: 'Appointment not found.' });
      }
  
      // Respond with the deleted appointment information or a success message
      res.json({ message: 'Appointment deleted successfully.', deletedAppointment: deleteResult.rows[0] });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error deleting appointment.' });
    }
  });




  app.post('/counselors', async (req, res) => {
    // Destructure the relevant information from the request body
    const { first_name, last_name, email, specialization, location } = req.body;
  
    try {
      // Prepare the SQL query to insert a new counselor
      const insertQuery = `
        INSERT INTO counselors (first_name, last_name, email, specialization, location)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *; 
      `;
      // Execute the query with the provided values
      const result = await pool.query(insertQuery, [first_name, last_name, email, specialization, location]);
  
      // Respond with the newly created counselor record
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creating counselor:', error);
      // Handle potential errors, such as duplicate email
      if (error.code === '23505') { // PostgreSQL error code for unique violation
        return res.status(400).json({error: 'A counselor with the given email already exists.'});
      }
      res.status(500).json({error: 'Server error while creating counselor.'});
    }
  });

  
  app.patch('/counselors', async (req, res) => {
 
    const { id, first_name, last_name, email, specialization, location } = req.body;
  
    // Constructing dynamic query based on provided fields
    const fields = { first_name, last_name, email, specialization, location };
    const setQuery = Object.entries(fields).filter(([_, v]) => v != null).map(([k, v], index) => `${k} = $${index + 1}`).join(", ");
    const values = Object.values(fields).filter(value => value != null);
  
    if (!setQuery) {
      return res.status(400).json({ error: "No valid fields provided for update." });
    }
  
    try {
      const result = await pool.query(
        `UPDATE counselors SET ${setQuery} WHERE id = $${values.length + 1} RETURNING *`,
        [...values, id]
      );
  
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Counselor not found.' });
      }
  
      res.json(result.rows[0]);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error updating counselor.' });
    }
  });
  
  // Get all counselors
app.get('/counselors', async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM counselors');
      res.json(result.rows);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error retrieving counselors.' });
    }
  });
  
  // Get a specific counselor by ID
  app.get('/counselors/:id', async (req, res) => {
    const { id } = req.params;
  
    try {
      const result = await pool.query('SELECT * FROM counselors WHERE id = $1', [id]);
  
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Counselor not found.' });
      }
  
      res.json(result.rows[0]);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error retrieving counselor.' });
    }
  });

  //delete counselor
  app.delete('/counselors/:id', async (req, res) => {
    const { id } = req.params;
  
    try {
      const deleteResult = await pool.query('DELETE FROM counselors WHERE id = $1 RETURNING *', [id]);
  
      if (deleteResult.rows.length === 0) {
        return res.status(404).json({ error: 'Counselor not found.' });
      }
  
      res.json({ message: 'Counselor deleted successfully.', deletedCounselor: deleteResult.rows[0] });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error deleting counselor.' });
    }
  });
  
  
  app.patch('/counselors/:id/availability', async (req, res) => {
    const { id } = req.params; // Extracting the counselor ID from the URL parameter
    const { availability } = req.body; // Extracting availability data from the request body

    // Validate the input data as needed (e.g., ensure availability is properly structured)
    // For example, check if availability is an object, or more specific validations as needed
    // console.log('ID:', id); // Debugging output
    // console.log('Availability:', availability);
    try {
        // Update the counselor's availability using the JSONB set function
        // Ensure the availability data is correctly formatted as a JSON string
        // The ::jsonb cast is used to ensure the data type matches the column
        const result = await pool.query(
            `UPDATE counselors
            SET availability = $1::jsonb
            WHERE id = $2
            RETURNING *;`, // Returning the updated row to send back to the client
            [JSON.stringify(availability), id] // Using JSON.stringify to ensure the availability is formatted as a JSON string
        );

        if (result.rows.length === 0) {
            // No row was updated, which means no counselor was found with the given ID
            return res.status(404).json({ error: 'Counselor not found.' });
        }

        // Respond with the updated counselor entry
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating counselor availability:', error);
        res.status(500).json({ error: 'Server error while updating counselor availability.' });
    }
});

app.get('/counselors/:id/availability', async (req, res) => {
  const { id } = req.params; // Extracting the counselor ID from the URL parameter

  try {
      // Query the database for the counselor's availability using their ID
      const result = await pool.query(
          'SELECT availability FROM counselors WHERE id = $1;', 
          [id]
      );

      if (result.rows.length === 0) {
          // If no counselor is found with the given ID, return a 404 not found error
          return res.status(404).json({ error: 'Counselor not found.' });
      }

      // Respond with the counselor's availability
      // Since we're only querying for the availability, result.rows[0] will directly contain the availability JSON
      res.json(result.rows[0].availability);
  } catch (error) {
      console.error('Error retrieving counselor availability:', error);
      res.status(500).json({ error: 'Server error while fetching counselor availability.' });
  }
});


//create thought diary

app.post('/thought-diaries', async (req, res) => {
  // Destructure 'mood' instead of 'tags', along with the other fields
  const { student_id, content, mood, title, color } = req.body;

  try {
      const newEntry = await pool.query(
          'INSERT INTO thought_diaries (student_id, content, mood, title, color) VALUES ($1, $2, $3, $4, $5) RETURNING *',
          [student_id, content, mood, title, color]  
      );
      res.status(201).json(newEntry.rows[0]);
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error creating diary entry.' });
  }
});



//List diaries of the student
app.get('/thought-diaries/:student_id', async (req, res) => {
    const { student_id } = req.params;

    try {
        const entries = await pool.query(
            'SELECT * FROM thought_diaries WHERE student_id = $1 ORDER BY entry_date DESC',
            [student_id]
        );
        res.json(entries.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error retrieving diary entries.' });
    }
});

//edit Diary
app.patch('/thought-diaries/:entryId', async (req, res) => {
    const { entryId } = req.params;
    const { content, tags } = req.body; // Assuming you allow updating content and tags

    // Authentication and authorization logic here
    // For example, ensure the user requesting the update owns the diary entry

    try {
        const updateQuery = `
            UPDATE thought_diaries
            SET content = COALESCE($1, content),
                tags = COALESCE($2, tags)
            WHERE id = $3
            RETURNING *;
        `;
        const updatedEntry = await pool.query(updateQuery, [content, tags, entryId]);

        if (updatedEntry.rows.length === 0) {
            return res.status(404).json({ error: 'Diary entry not found or not authorized to update.' });
        }

        res.json(updatedEntry.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error updating diary entry.' });
    }
});

//delete diary

app.delete('/thought-diaries/:entryId', async (req, res) => {
    const { entryId } = req.params;

    // Authentication and authorization logic here
    // Ensure the user requesting the deletion owns the diary entry

    try {
        const deleteResult = await pool.query('DELETE FROM thought_diaries WHERE id = $1 RETURNING *', [entryId]);

        if (deleteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Diary entry not found or not authorized to delete.' });
        }

        res.json({ message: 'Diary entry deleted successfully.', deletedEntry: deleteResult.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error deleting diary entry.' });
    }
});


app.post('/workouts', async (req, res) => {
    const { title, description, difficulty, duration } = req.body;

    try {
        const newWorkout = await pool.query(
            'INSERT INTO workouts (title, description, difficulty, duration) VALUES ($1, $2, $3, $4) RETURNING *',
            [title, description, difficulty, duration]
        );
        res.status(201).json(newWorkout.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error creating workout.' });
    }
});

// Get all workouts
app.get('/workouts', async (req, res) => {
    try {
        const results = await pool.query('SELECT * FROM workouts');
        res.json(results.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching workouts.' });
    }
});

// Get a specific workout by ID
app.get('/workouts/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query('SELECT * FROM workouts WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Workout not found.' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error retrieving workout.' });
    }
});

// Get all workouts
app.get('/workouts', async (req, res) => {
    try {
        const results = await pool.query('SELECT * FROM workouts');
        res.json(results.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching workouts.' });
    }
});

//update workout
app.patch('/workouts/:id', async (req, res) => {
    const { id } = req.params;
    const { title, description, difficulty, duration } = req.body;

    try {
        const updateResult = await pool.query(
            'UPDATE workouts SET title = COALESCE($1, title), description = COALESCE($2, description), difficulty = COALESCE($3, difficulty), duration = COALESCE($4, duration) WHERE id = $5 RETURNING *',
            [title, description, difficulty, duration, id]
        );

        if (updateResult.rows.length === 0) {
            return res.status(404).json({ error: 'Workout not found.' });
        }

        res.json(updateResult.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error updating workout.' });
    }
});

//delete workout
app.delete('/workouts/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const deleteResult = await pool.query('DELETE FROM workouts WHERE id = $1 RETURNING *', [id]);

        if (deleteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Workout not found.' });
        }

        res.json({ message: 'Workout deleted successfully.', deletedWorkout: deleteResult.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error deleting workout.' });
    }
});

app.post('/student-workouts/:workoutId/exercises', async (req, res) => {
  const { workoutId } = req.params;
  const { name, description, repetitions, sets, duration, rest_period, student_id } = req.body;

  try {
    const newExercise = await pool.query(
      'INSERT INTO student_exercises (workout_id, name, description, repetitions, sets, duration, rest_period, student_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [workoutId, name, description, repetitions, sets, duration, rest_period, student_id]
    );
    res.status(201).json(newExercise.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error creating exercise.' });
  }
});

app.get('/student-workouts/:workoutId/exercises', async (req, res) => {
  const { workoutId } = req.params;

  try {
    const exercises = await pool.query(
      'SELECT * FROM student_exercises WHERE workout_id = $1',
      [workoutId]
    );
    res.json(exercises.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error fetching exercises.' });
  }
});

app.patch('/student-exercises/:exerciseId', async (req, res) => {
  const { exerciseId } = req.params;
  const { name, description, repetitions, sets, duration, rest_period } = req.body;

  try {
    const updateResult = await pool.query(
      'UPDATE student_exercises SET name = $1, description = $2, repetitions = $3, sets = $4, duration = $5, rest_period = $6 WHERE id = $7 RETURNING *',
      [name, description, repetitions, sets, duration, rest_period, exerciseId]
    );
    if (updateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Exercise not found.' });
    }
    res.json(updateResult.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error updating exercise.' });
  }
});


app.delete('/student-exercises/:exerciseId', async (req, res) => {
  const { exerciseId } = req.params;

  try {
    const deleteResult = await pool.query(
      'DELETE FROM student_exercises WHERE id = $1 RETURNING *',
      [exerciseId]
    );
    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Exercise not found.' });
    }
    res.json({ message: 'Exercise deleted successfully.', deletedExercise: deleteResult.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error deleting exercise.' });
  }
});

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });
