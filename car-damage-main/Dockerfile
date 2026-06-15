FROM python:3.11

WORKDIR /app

COPY . .

RUN pip install --upgrade pip
RUN pip install -r requirements.txt

EXPOSE 7860

CMD ["gunicorn", "--bind", "0.0.0.0:7860", "app:app"]