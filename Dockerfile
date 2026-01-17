# Use Python image
FROM python:3.10-slim

# Install dependencies
RUN pip install flask flask-cors youtube-transcript-api gunicorn

# Set working directory
WORKDIR /app

# Copy project files
COPY . .

# Expose port 5000 for Flask/Gunicorn
EXPOSE 5000

# Start the application using gunicorn
# In a real setup, you might want Nginx in front, but for this project, 
# we can serve the API via Flask and the user can host static files or we can serve them via Flask.
# Let's update app.py to also serve static files for convenience.

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"]
