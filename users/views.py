
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models import Resident
from .serializers import ResidentSerializer


@api_view(['GET', 'POST'])
def resident_list(request):

    if request.method == 'GET':
        residents = Resident.objects.all()
        serializer = ResidentSerializer(residents, many=True)
        return Response(serializer.data)

    elif request.method == 'POST':
        serializer = ResidentSerializer(data=request.data)

        if serializer.is_valid():
            serializer.save()
            return Response(
                serializer.data,
                status=status.HTTP_201_CREATED
            )

        return Response(
            serializer.errors,
            status=status.HTTP_400_BAD_REQUEST
        )

@api_view(['GET', 'PATCH', 'DELETE'])
def resident_detail(request, pk):
    try:
        resident = Resident.objects.get(pk=pk)
    except Resident.DoesNotExist:
        return Response(
            {"error": "Resident not found"},
            status=status.HTTP_404_NOT_FOUND
        )

    if request.method == 'GET':
        serializer = ResidentSerializer(resident)
        return Response(serializer.data)

    elif request.method == 'PATCH':
        serializer = ResidentSerializer(
            resident,
            data=request.data,
            partial=True
        )

        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)

        return Response(
            serializer.errors,
            status=status.HTTP_400_BAD_REQUEST
        )

    elif request.method == 'DELETE':
        resident.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
